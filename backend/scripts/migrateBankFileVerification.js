import mongoose from "mongoose";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";

// Bank TXT verification by Accounting started after files had already been generated. Product
// decision: every earlier file counts as verified, so Treasury keeps downloading and confirming it.
// Marks each batch without a verification status as VERIFIED (legacy); the code already treats a
// missing status that way, so running this only makes the decision explicit and auditable.
export async function migrateBankFileVerification(db, { apply = false, now = new Date() } = {}) {
  const query = { "verification.status": { $exists: false } };
  const batches = await db.collection("paymentbatches").find(query, { projection: { batchNumber: 1, generatedAt: 1 } }).toArray();
  const report = { mode: apply ? "APPLY" : "DRY_RUN", legacyVerified: batches.map((batch) => batch.batchNumber) };
  if (!apply) return report;
  for (const batch of batches) {
    const verification = { status: "VERIFIED", legacy: true, verifiedAt: batch.generatedAt || now };
    // Only a batch still unmarked is changed, so a rerun or a concurrent verification is left alone.
    const result = await db.collection("paymentbatches").updateOne({ _id: batch._id, ...query }, { $set: { verification } });
    if (!result.modifiedCount) continue;
    await db.collection("generatedfiles").updateOne({ "metadata.batchId": batch._id }, { $set: { "metadata.verification": verification } });
    await db.collection("auditlogs").insertOne({
      action: "BANK_FILE_LEGACY_VERIFIED", actorName: "System migration", role: "SYSTEM", module: "ACCOUNTING",
      entity: "PaymentBatch", entityType: "PaymentBatch", entityId: batch._id, createdAt: now,
      comments: "Generated before Accounting verification of bank files; treated as verified.",
      newValues: { batchNumber: batch.batchNumber, verification }
    });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
    console.log(JSON.stringify(await migrateBankFileVerification(mongoose.connection.db, { apply: process.argv.includes("--apply") }), null, 2));
  } finally { await mongoose.disconnect(); }
}
