import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import { planDemoAccountRemoval, removeDemoAccounts } from "../src/services/demoAccountRemovalService.js";

test("retired demo accounts go with their requests, and their budget use is given back", { timeout: 30000 }, async () => {
  const database = `erp_demo_account_removal_${process.pid}_${Date.now()}`;
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "uma-demo-removal-"));
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = mongoose.connection.db;
    const director = new mongoose.Types.ObjectId();
    const requester = new mongoose.Types.ObjectId();
    const colleague = new mongoose.Types.ObjectId();
    await db.collection("users").insertMany([
      { _id: requester, name: "Solicitante (Demo)", email: "demo.solicitante.salud@uma.edu.pe", dni: "10000002", role: "Solicitor", jefe: director },
      { _id: director, name: "Director (Demo)", email: "demo.director.salud@uma.edu.pe", dni: "10000003", role: "AreaDirector" },
      { name: "Admin (Demo)", email: "demo.admin@uma.edu.pe", dni: "10000001", role: "Admin" },
      // Real people: one reports to a demo director, one happens to share a retired DNI.
      { _id: colleague, name: "Real colleague", email: "colleague@uma.edu.pe", dni: "40000001", role: "Solicitor", jefe: director },
      { name: "Real namesake", email: "person@uma.edu.pe", dni: "10000008", role: "Management" }
    ]);
    const request = new mongoose.Types.ObjectId();
    const payable = new mongoose.Types.ObjectId();
    const plan = new mongoose.Types.ObjectId();
    await db.collection("financialrequests").insertMany([
      { _id: request, requestNumber: "SOL-2026-30005", requester, status: "CONTABILIZADO", accountsPayable: payable },
      { requestNumber: "SOL-2026-00001", requester: colleague, status: "APROBADO", approvalRouteSnapshot: [{ approverUser: director, status: "APPROVED" }] }
    ]);
    await db.collection("accountspayables").insertOne({ _id: payable, request });
    await db.collection("journalentries").insertOne({ accountsPayable: payable });
    await db.collection("requestcomments").insertOne({ request, text: "Demo comment" });
    await db.collection("notifications").insertMany([{ user: director, eventKey: "a" }, { user: colleague, eventKey: "b", entityId: request }]);
    // 1,000 reserved in month 3, of which 400 executed and 100 paid; a released one holds only its execution.
    await db.collection("budgetallocations").insertOne({ _id: plan, code: "PLAN", committedAmount: 600, executedAmount: 450, paidAmount: 100, months: [{}, {}, { month: 3, committedAmount: 600, executedAmount: 450, paidAmount: 100 }] });
    // This test models legacy duplicate commitments; only this disposable test DB
    // relaxes the modern unique index for request so the cleanup routine can be exercised.
    // When the suite runs in one process (test/run.js) the BudgetCommitment model is registered
    // and mongoose.connect() starts its index build in the background: wait for it, or it can
    // recreate request_1 after the drop below. Run alone, the collection may not exist yet.
    if (mongoose.models.BudgetCommitment) await mongoose.models.BudgetCommitment.init().catch(() => {});
    await db.createCollection("budgetcommitments").catch((error) => { if (error.codeName !== "NamespaceExists") throw error; });
    const bcIndexes = await db.collection("budgetcommitments").indexes();
    if (bcIndexes.some((idx) => idx.name === "request_1")) await db.collection("budgetcommitments").dropIndex("request_1");
    await db.collection("budgetcommitments").insertMany([
      { request, status: "PARTIALLY_PAID", lines: [{ mode: "ACTIVE", allocation: plan, budgetMonth: 3, amount: 1000, executedAmount: 400, paidAmount: 100 }] },
      { request, status: "RELEASED", lines: [{ mode: "ACTIVE", allocation: plan, budgetMonth: 3, amount: 300, executedAmount: 50, paidAmount: 0 }] }
    ]);
    await db.collection("auditlogs").insertOne({ action: "HISTORICAL", actor: requester });

    const preview = await removeDemoAccounts(db, { backupDir });
    assert.equal(preview.mode, "DRY_RUN");
    assert.deepEqual(preview.accounts, ["10000002 Solicitante (Demo)", "10000003 Director (Demo)"], "only accounts the seed created");
    assert.deepEqual(preview.counts, { users: 2, financialrequests: 1, accountspayables: 1, journalentries: 1, budgetcommitments: 2, requestcomments: 1, notifications: 2 });
    assert.equal(preview.usersRelinked, 1);
    assert.equal(await db.collection("users").countDocuments(), 5, "a dry run changes nothing");

    // Someone else's request waiting on a demo approver, or a bank file shared with it, stops the removal.
    await db.collection("financialrequests").updateOne({ requester: colleague }, { $set: { "approvalRouteSnapshot.0.status": "PENDING" } });
    await assert.rejects(planDemoAccountRemoval(db), /SOL-2026-00001.*Reassign/);
    await db.collection("financialrequests").updateOne({ requester: colleague }, { $set: { "approvalRouteSnapshot.0.status": "APPROVED" } });
    await db.collection("paymentbatches").insertOne({ items: [{ request }, { request: new mongoose.Types.ObjectId() }] });
    await assert.rejects(planDemoAccountRemoval(db), /payment batch mixes/);
    await db.collection("paymentbatches").deleteMany({});

    const applied = await removeDemoAccounts(db, { apply: true, backupDir });
    assert.equal(applied.mode, "APPLY");
    assert.deepEqual((await db.collection("users").find({}).sort({ dni: 1 }).toArray()).map((user) => user.dni), ["10000001", "10000008", "40000001"]);
    assert.equal((await db.collection("users").findOne({ _id: colleague })).jefe, null, "the colleague no longer reports to a removed account");
    assert.deepEqual((await db.collection("financialrequests").find({}).toArray()).map((row) => row.requestNumber), ["SOL-2026-00001"]);
    for (const name of ["accountspayables", "journalentries", "budgetcommitments", "requestcomments"]) assert.equal(await db.collection(name).countDocuments(), 0, name);
    assert.equal(await db.collection("notifications").countDocuments(), 0);
    const budget = await db.collection("budgetallocations").findOne({ _id: plan });
    assert.deepEqual([budget.committedAmount, budget.executedAmount, budget.paidAmount], [0, 0, 0]);
    assert.deepEqual([budget.months[2].committedAmount, budget.months[2].executedAmount, budget.months[2].paidAmount], [0, 0, 0]);
    assert.deepEqual((await db.collection("auditlogs").find({}).sort({ _id: 1 }).toArray()).map((row) => row.action), ["HISTORICAL", "DEMO_ACCOUNTS_REMOVED"], "audit history is kept");
    const manifest = JSON.parse(await fs.readFile(path.join(applied.backup, "manifest.json"), "utf8"));
    assert.equal(manifest.counts.financialrequests, 1);
    assert.ok((await fs.readFile(path.join(applied.backup, "users.ejson"), "utf8")).includes("10000003"), "every removed record is backed up first");
    assert.deepEqual((await removeDemoAccounts(db, { apply: true, backupDir })).accounts, [], "nothing left the second time");
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await fs.rm(backupDir, { recursive: true, force: true });
  }
});
