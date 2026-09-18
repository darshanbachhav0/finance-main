import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { canonicalRequestStatus, deriveFinancialProgress, isTerminalRequest } from "../../shared/workflowStatus.mjs";

export const MIGRATION_KEY = "2026-09-workflow-status-v2";
const financialStatuses = ["PROVISIONADO_CXP", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "RENDICION_PENDIENTE"];

// Only workflow metadata and indexes change. Original journals, confirmations,
// reconciliation documents, attachments and approval/audit history remain untouched.
export async function migrateWorkflowStatuses(db, { apply = false } = {}) {
  const report = { mode: apply ? "APPLY" : "DRY_RUN", database: db.databaseName, scanned: 0, changes: [], manualReview: [], conflicts: [], indexesToDrop: [], indexesToCreate: [] };
  const reconciliation = db.collection("reconciliations");
  const indexes = await reconciliation.indexes().catch(error => {
    if (error.code === 26) return [];
    throw error;
  });
  const duplicates = await reconciliation.aggregate([
    { $match: { scope: "PAYABLE" } },
    { $group: { _id: "$accountsPayable", count: { $sum: 1 } } },
    { $match: { $or: [{ _id: null }, { count: { $gt: 1 } }] } }
  ]).toArray();
  if (duplicates.length) throw new Error("Reconciliation uniqueness conflicts require manual review before migration: " + JSON.stringify(duplicates));
  const legacyIndexes = indexes.filter(index => index.unique && Object.keys(index.key).length === 1 && index.key.request === 1);
  report.indexesToDrop = legacyIndexes.map(index => index.name);
  if (!indexes.some(index => index.name === "reconciliation_payable_unique")) report.indexesToCreate.push("reconciliation_payable_unique");
  if (apply) {
    // Install the per-payable constraint before removing the obsolete per-request constraint.
    await reconciliation.createIndex({ accountsPayable: 1 }, { name: "reconciliation_payable_unique", unique: true, partialFilterExpression: { scope: "PAYABLE" } });
    for (const index of legacyIndexes) await reconciliation.dropIndex(index.name);
    await reconciliation.createIndex({ request: 1 });
    await db.collection("workflowstatusmigrations").createIndex({ migration: 1, request: 1 }, { unique: true });
  }
  for await (const request of db.collection("financialrequests").find({})) {
    report.scanned++;
    let target = canonicalRequestStatus(request.status);
    const legacyRenditionObservation = (request.flowType === "C" || request.requestType === "ENTREGA_RENDIR") && request.status === "OBSERVADO_PRESUPUESTO" && request.payment?.confirmedAt;
    if (!isTerminalRequest(request.status) && (financialStatuses.includes(request.status) || legacyRenditionObservation)) {
      const payables = await db.collection("accountspayables").find({ request: request._id }).toArray();
      for (const ap of payables) {
        if (ap.paymentBatch) ap.paymentBatch = await db.collection("paymentbatches").findOne({ _id: ap.paymentBatch });
        for (const field of ["provisionJournal", "paymentJournal"]) if (ap[field]) ap[field] = await db.collection("journalentries").findOne({ _id: ap[field] });
      }
      const [records, order, vouchers] = await Promise.all([
        reconciliation.find({ request: request._id }).toArray(),
        db.collection("purchaseorders").findOne({ request: request._id }),
        db.collection("sunatvouchers").find({ request: request._id }).toArray()
      ]);
      const progress = deriveFinancialProgress(request, payables, records, order, vouchers);
      if (!progress.status) {
        report.manualReview.push({ request: String(request._id), requestNumber: request.requestNumber, status: request.status, reason: "Insufficient child evidence to derive a safe financial milestone." });
        continue;
      }
      target = progress.status;
    }
    if (target === request.status && request.workflowVersion === 2) continue;
    const change = { request: String(request._id), requestNumber: request.requestNumber, from: request.status, to: target };
    report.changes.push(change);
    if (!apply) continue;
    const manifest = db.collection("workflowstatusmigrations");
    await manifest.updateOne({ migration: MIGRATION_KEY, request: request._id }, { $setOnInsert: {
      migration: MIGRATION_KEY, request: request._id, plannedAt: new Date(),
      previous: { status: request.status, workflowVersion: request.workflowVersion, legacyWorkflowStatus: request.legacyWorkflowStatus, updatedAt: request.updatedAt },
      target, state: "PLANNED"
    } }, { upsert: true });
    const result = await db.collection("financialrequests").updateOne({
      _id: request._id, status: request.status,
      ...(request.updatedAt ? { updatedAt: request.updatedAt } : { updatedAt: { $exists: false } }),
      ...(request.__v === undefined ? { __v: { $exists: false } } : { __v: request.__v })
    }, { $set: { status: target, workflowVersion: 2, ...(target !== request.status && !request.legacyWorkflowStatus ? { legacyWorkflowStatus: request.status } : {}) }, $inc: { __v: 1 } });
    if (!result.modifiedCount) { report.conflicts.push(change); continue; }
    await manifest.updateOne({ migration: MIGRATION_KEY, request: request._id }, { $set: { state: "APPLIED", appliedAt: new Date() } });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  const expected = process.argv.find(arg => arg.startsWith("--database="))?.slice("--database=".length);
  try {
    if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI explicitly; no default database is used.");
    if (apply && (!expected || !process.argv.includes("--maintenance-confirmed"))) throw new Error("Apply requires --database=<exact-name> --maintenance-confirmed. Stop API/workers and take a verified backup first.");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    if (expected && mongoose.connection.name !== expected) throw new Error("Connected database does not match --database.");
    const report = await migrateWorkflowStatuses(mongoose.connection.db, { apply });
    console.log(JSON.stringify(report, null, 2));
    if (report.manualReview.length || report.conflicts.length) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
