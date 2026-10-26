import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { backupDirectory } from "./backupService.js";
import { generatedRoot, uploadRoot } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { BUDGET_STATUS } from "../utils/constants.js";

// Demo accounts the development seed used to create and no longer does: the three requesters,
// the three area directors, the Vice Rector, Management and Procurement. Admin (10000001),
// Accounting (10000005), Treasury (10000006) and Treasury - Budget (10000007) stay.
export const RETIRED_DEMO_DNIS = Object.freeze(["10000002", "10000003", "10000004", "10000008", "10000009", "10000010", "10000011", "10000012", "10000013"]);

// Removes those accounts and everything they own: their requests and each request's purchase
// order, invoices, journals, budget commitment (its budget use is given back), payment batches and
// bank files, comments, notifications, drafts and uploaded files. Dry-run unless apply; every
// removed record is first written to an EJSON backup. Audit history is append-only and stays.
// Run from npm run demo:remove-accounts (scripts/removeDemoAccounts.js) or by the seed.

// Records that hang off a request (field request) or off one of its payables (accountsPayable).
const REQUEST_CHILDREN = ["purchaseorders", "journalentries", "sunatvouchers", "reconciliations", "budgetcommitments", "budgetexceptions", "accountingentries", "invoiceobservations", "xmlvalidationattempts", "massuploadbatches", "requestcomments", "suppliercredits"];
// Retained records of these kinds must not point at a removed record.
const CHECKED_COLLECTIONS = ["financialrequests", "accountspayables", "paymentbatches", "generatedfiles", ...REQUEST_CHILDREN];

const { EJSON } = mongoose.mongo.BSON;
const ids = (rows) => rows.map((row) => row._id);
const key = (value) => String(value);
const digest = (rows) => createHash("sha256").update(EJSON.stringify(rows)).digest("hex");
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

// What a commitment holds on its budget plan (or Cost Center) right now, per ACTIVE line: the
// unexecuted reservation (none once released or while deferred), the executed and the paid amount.
function heldUsage(commitment) {
  const reserved = ![BUDGET_STATUS.RELEASED, BUDGET_STATUS.DEFERRED].includes(commitment.status);
  return (commitment.lines || []).filter((line) => line.mode === "ACTIVE").map((line) => ({
    collection: line.allocation ? "budgetallocations" : "costcenters",
    id: line.allocation || line.costCenter,
    budgetMonth: line.allocation ? line.budgetMonth : undefined,
    committedAmount: reserved ? Math.max(0, money(line.amount - (line.executedAmount || 0))) : 0,
    executedAmount: money(line.executedAmount),
    paidAmount: money(line.paidAmount)
  }));
}

// The $inc that gives each budget plan / Cost Center back what the removed commitments hold.
function budgetReversal(commitments) {
  const reversal = new Map();
  for (const usage of commitments.flatMap(heldUsage)) {
    const target = `${usage.collection}:${key(usage.id)}`;
    const entry = reversal.get(target) || { collection: usage.collection, id: usage.id, inc: {} };
    const prefixes = usage.budgetMonth ? ["", `months.${usage.budgetMonth - 1}.`] : [""];
    for (const field of ["committedAmount", "executedAmount", "paidAmount"]) {
      if (!usage[field]) continue;
      for (const prefix of prefixes) entry.inc[prefix + field] = money((entry.inc[prefix + field] || 0) - usage[field]);
    }
    reversal.set(target, entry);
  }
  return [...reversal.values()].filter((entry) => Object.keys(entry.inc).length);
}

const valueAt = (row, dotted) => dotted.split(".").reduce((value, part) => value?.[part], row);

export async function planDemoAccountRemoval(db, session) {
  const read = (name, query) => db.collection(name).find(query, { session }).sort({ _id: 1 }).toArray();
  const plan = {};
  // Only the accounts the seed created: a real person who happens to have one of these DNIs is kept.
  plan.users = await read("users", { dni: { $in: [...RETIRED_DEMO_DNIS] }, email: /^demo\./ });
  const userIds = ids(plan.users);
  plan.financialrequests = await read("financialrequests", { requester: { $in: userIds } });
  const requestIds = ids(plan.financialrequests);
  plan.accountspayables = await read("accountspayables", { request: { $in: requestIds } });
  const payableIds = ids(plan.accountspayables);
  for (const name of REQUEST_CHILDREN) plan[name] = await read(name, { $or: [{ request: { $in: requestIds } }, { accountsPayable: { $in: payableIds } }] });
  plan.paymentbatches = await read("paymentbatches", { "items.request": { $in: requestIds } });
  plan.generatedfiles = await read("generatedfiles", { requestIds: { $in: requestIds } });
  plan.employeereimbursementbankaccounts = await read("employeereimbursementbankaccounts", { user: { $in: userIds } });
  plan.workdrafts = await read("workdrafts", { $or: [{ owner: { $in: userIds } }, { recordId: { $in: requestIds.map(key) } }] });
  const recordIds = Object.entries(plan).filter(([name]) => name !== "users").flatMap(([, rows]) => ids(rows));
  plan.notifications = await read("notifications", { $or: [{ user: { $in: userIds } }, { entityId: { $in: recordIds } }] });
  plan.notificationdeliveries = await read("notificationdeliveries", { $or: [{ user: { $in: userIds } }, { notification: { $in: ids(plan.notifications) } }] });

  // A bank file or payment batch that also pays someone else's request needs a person to decide.
  const requestSet = new Set(requestIds.map(key));
  if (plan.paymentbatches.some((batch) => batch.items.some((item) => !requestSet.has(key(item.request))))) throw new Error("A payment batch mixes these demo requests with other requests: manual review required.");
  if (plan.generatedfiles.some((file) => file.requestIds.some((id) => !requestSet.has(key(id))))) throw new Error("A generated file mixes these demo requests with other requests: manual review required.");

  // Nothing kept may be left pointing at a removed record (people may: an approval they gave stays).
  const selected = new Set(recordIds.map(key));
  const containsSelected = (value) => {
    if (value == null) return false;
    if (Array.isArray(value)) return value.some(containsSelected);
    if (typeof value === "object" && value._bsontype !== "ObjectId" && !(value instanceof Date)) return Object.values(value).some(containsSelected);
    return selected.has(key(value));
  };
  for (const name of CHECKED_COLLECTIONS) {
    const removed = ids(plan[name] || []);
    const retained = await db.collection(name).find({ _id: { $nin: removed } }, { session, projection: { payload: 0 } }).toArray();
    const stranded = retained.find(containsSelected);
    if (stranded) throw new Error(`A kept ${name} record (${stranded.requestNumber || stranded._id}) references this demo data: manual review required.`);
  }
  // Someone else's request waiting on one of these accounts would never be approved.
  const waiting = await db.collection("financialrequests").find({ _id: { $nin: requestIds }, approvalRouteSnapshot: { $elemMatch: { approverUser: { $in: userIds }, status: "PENDING" } } }, { session, projection: { requestNumber: 1 } }).toArray();
  if (waiting.length) throw new Error(`Requests waiting on a demo account's approval: ${waiting.map((row) => row.requestNumber).join(", ")}. Reassign them first.`);

  // Kept people who report to (or are covered by) a removed account lose that link.
  const relinked = await db.collection("users").find({ _id: { $nin: userIds }, $or: [{ jefe: { $in: userIds } }, { substitute: { $in: userIds } }] }, { session, projection: { _id: 1 } }).toArray();
  const reversal = budgetReversal(plan.budgetcommitments);
  for (const entry of reversal) {
    const target = await db.collection(entry.collection).findOne({ _id: entry.id }, { session });
    if (!target) continue;
    for (const [field, change] of Object.entries(entry.inc)) {
      if (money((valueAt(target, field) || 0) + change) < 0) throw new Error(`Giving back the budget of ${target.code || target._id} would leave ${field} below zero: manual review required.`);
    }
  }
  return { plan, reversal, relinked: ids(relinked) };
}

function counts(plan) {
  return Object.fromEntries(Object.entries(plan).map(([name, rows]) => [name, rows.length]).filter(([, count]) => count));
}

// Uploaded evidence lives in uploads/requests/<request id>/ and bank files in generated/; on Render
// they are also kept in the protectedAssets GridFS bucket (durableAssetService).
async function removeFiles(db, plan) {
  const requestFolders = ids(plan.financialrequests).map((id) => `/uploads/requests/${id}/`);
  const generated = [...plan.paymentbatches, ...plan.generatedfiles].map((row) => row.url).filter((url) => url?.startsWith("/generated/"));
  for (const folder of requestFolders) await fs.rm(path.join(uploadRoot, ...folder.split("/").slice(2)), { recursive: true, force: true });
  for (const url of new Set(generated)) await fs.rm(path.join(generatedRoot, ...url.split("/").slice(2)), { force: true });
  const files = db.collection("protectedAssets.files");
  const assets = await files.find({ $or: [{ filename: { $in: [...new Set(generated)] } }, ...requestFolders.map((folder) => ({ filename: { $regex: `^${folder}` } }))] }, { projection: { _id: 1 } }).toArray();
  if (!assets.length) return 0;
  await db.collection("protectedAssets.chunks").deleteMany({ files_id: { $in: ids(assets) } });
  await files.deleteMany({ _id: { $in: ids(assets) } });
  return assets.length;
}

export async function removeDemoAccounts(db, { apply = false, backupDir = backupDirectory() } = {}) {
  const { plan, reversal, relinked } = await planDemoAccountRemoval(db);
  const summary = { mode: apply ? "APPLY" : "DRY_RUN", database: db.databaseName, accounts: plan.users.map((user) => `${user.dni} ${user.name}`).sort(), counts: counts(plan), budgetsGivenBack: reversal.length, usersRelinked: relinked.length };
  if (!apply || !plan.users.length) return summary;

  const backup = path.join(backupDir, `demo-accounts-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await fs.mkdir(backup, { recursive: true });
  const hashes = {};
  for (const [name, rows] of Object.entries(plan)) {
    if (!rows.length) continue;
    hashes[name] = digest(rows);
    await fs.writeFile(path.join(backup, `${name}.ejson`), EJSON.stringify(rows), { flag: "wx" });
  }
  await fs.writeFile(path.join(backup, "manifest.json"), JSON.stringify({ database: db.databaseName, counts: summary.counts, hashes, budgetReversal: reversal, usersRelinked: relinked, createdAt: new Date() }, null, 2));

  await runFinancialOperation(async (session) => {
    const current = await planDemoAccountRemoval(db, session);
    for (const [name, rows] of Object.entries(current.plan)) if (rows.length && digest(rows) !== hashes[name]) throw new Error("The demo data changed after the backup; run again.");
    for (const [name, rows] of Object.entries(current.plan)) {
      if (rows.length) await db.collection(name).deleteMany({ _id: { $in: ids(rows) } }, { session });
    }
    for (const entry of current.reversal) await db.collection(entry.collection).updateOne({ _id: entry.id }, { $inc: entry.inc }, { session });
    await db.collection("users").updateMany({ _id: { $in: current.relinked }, jefe: { $in: ids(current.plan.users) } }, { $set: { jefe: null } }, { session });
    await db.collection("users").updateMany({ _id: { $in: current.relinked }, substitute: { $in: ids(current.plan.users) } }, { $set: { substitute: null } }, { session });
    const now = new Date();
    await db.collection("auditlogs").insertOne({
      module: "SYSTEM", entityType: "DemoDataset", action: "DEMO_ACCOUNTS_REMOVED", actorName: "System",
      message: "Retired demo accounts and their data removed; earlier audit records are kept.",
      newValues: { accounts: summary.accounts, counts: summary.counts, budgetsGivenBack: reversal.length, usersRelinked: relinked.length, backup: path.basename(backup) },
      createdAt: now, updatedAt: now
    }, { session });
  });
  return { ...summary, filesRemoved: await removeFiles(db, plan), backup };
}
