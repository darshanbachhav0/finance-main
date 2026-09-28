// One-off, idempotent migration for the accounting fixes (credit notes, CXP cancellation, periods).
// Dry run by default; pass --apply to write. Run once per existing database:
//   node scripts/migrateAccountingFixes.js [--apply]
// - Replaces the old AccountsPayable voucher unique index (it covered cancelled payables, so a
//   corrected invoice could never be registered) with the active-voucher index.
// - Marks cancelled payables voucherActive:false and backfills accountingPeriod/invoiceAmount.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import JournalEntry from "../src/models/JournalEntry.js";

const apply = process.argv.includes("--apply");

export async function migrateAccountingFixes({ apply: write = apply } = {}) {
  const summary = { dropIndex: false, cancelled: 0, backfilled: 0 };
  const indexes = await AccountsPayable.collection.indexes().catch(() => []);
  if (indexes.some((index) => index.name === "accounts_payable_voucher_unique")) {
    summary.dropIndex = true;
    if (write) await AccountsPayable.collection.dropIndex("accounts_payable_voucher_unique");
  }
  summary.cancelled = await AccountsPayable.countDocuments({ status: "CANCELLED", voucherActive: { $ne: false } });
  if (write) await AccountsPayable.updateMany({ status: "CANCELLED", voucherActive: { $ne: false } }, { $set: { voucherActive: false } });
  if (write) await AccountsPayable.updateMany({ status: { $ne: "CANCELLED" }, voucherActive: { $exists: false } }, { $set: { voucherActive: true } });
  const missing = await AccountsPayable.find({ accountingPeriod: { $exists: false } }).select("provisionJournal originalAmount penEquivalent").lean();
  for (const ap of missing) {
    const journal = ap.provisionJournal ? await JournalEntry.findById(ap.provisionJournal).select("period").lean() : null;
    if (!journal?.period) continue;
    summary.backfilled += 1;
    if (write) await AccountsPayable.updateOne({ _id: ap._id }, { $set: { accountingPeriod: journal.period, invoiceAmount: ap.originalAmount, invoicePenEquivalent: ap.penEquivalent } });
  }
  if (write) await AccountsPayable.createIndexes();
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await connectDB();
  try {
    console.log(JSON.stringify({ apply, ...(await migrateAccountingFixes()) }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}
