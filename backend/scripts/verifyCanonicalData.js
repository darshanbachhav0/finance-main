import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { CANONICAL_REQUEST_STATUSES } from "../src/utils/constants.js";

const legacyStatuses = ["APROBADO_POR_PAGAR", "PROCESADO_BANCO", "LIQUIDADO_CERRADO"];

async function indexNames(db, collectionName) {
  const exists = await db.listCollections({ name: collectionName }).hasNext();
  if (!exists) return [];
  return (await db.collection(collectionName).listIndexes().toArray()).map((index) => index.name);
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const requests = db.collection("financialrequests");
  const [
    requestCount,
    legacyStatusCount,
    unknownStatusCount,
    manualReviewCount,
    duplicateNumbers,
    accountsPayableCount,
    journalCount,
    batchCount,
    reconciliationCount,
    migrationRun
  ] = await Promise.all([
    requests.countDocuments(),
    requests.countDocuments({ status: { $in: legacyStatuses } }),
    requests.countDocuments({ status: { $nin: CANONICAL_REQUEST_STATUSES } }),
    requests.countDocuments({ "migrationReview.required": true }),
    requests.aggregate([{ $group: { _id: "$requestNumber", count: { $sum: 1 } } }, { $match: { _id: { $ne: null }, count: { $gt: 1 } } }]).toArray(),
    db.collection("accountspayables").countDocuments(),
    db.collection("journalentries").countDocuments(),
    db.collection("paymentbatches").countDocuments(),
    db.collection("reconciliations").countDocuments(),
    db.collection("migrationruns").findOne({ key: "2026-08-canonical-workflow-v1" })
  ]);

  const criticalIndexes = {};
  for (const name of ["financialrequests", "suppliers", "accountspayables", "journalentries", "paymentbatches", "auditlogs", "notifications"]) {
    criticalIndexes[name] = await indexNames(db, name);
  }

  const result = {
    success: legacyStatusCount === 0 && unknownStatusCount === 0 && duplicateNumbers.length === 0,
    requestCount,
    legacyStatusCount,
    unknownStatusCount,
    duplicateRequestNumbers: duplicateNumbers,
    manualReviewCount,
    accountsPayableCount,
    journalCount,
    paymentBatchCount: batchCount,
    reconciliationCount,
    migrationAppliedAt: migrationRun?.appliedAt || null,
    criticalIndexes
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
