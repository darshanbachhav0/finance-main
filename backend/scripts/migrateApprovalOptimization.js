import mongoose from "mongoose";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";

// Add indexes only. Historical payments, invoice treatment and provider approvals are untouched.
export async function migrateApprovalOptimization(db, { apply = false } = {}) {
  const indexes = [
    { collection: "paymentbatches", key: { generationKey: 1 }, options: { name: "generationKey_1", unique: true, partialFilterExpression: { generationKey: { $type: "string" } } } },
    { collection: "accountspayables", key: { status: 1, "detraction.confirmedAt": 1 }, options: { name: "status_1_detraction.confirmedAt_1" } }
  ];
  if (apply) for (const item of indexes) await db.collection(item.collection).createIndex(item.key,item.options);
  return { mode: apply ? "APPLY" : "DRY_RUN", indexes, historicalRecordsModified: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
    await mongoose.connect(process.env.MONGODB_URI,{ autoIndex: false });
    console.log(JSON.stringify(await migrateApprovalOptimization(mongoose.connection.db,{ apply: process.argv.includes("--apply") }),null,2));
  } finally { await mongoose.disconnect(); }
}
