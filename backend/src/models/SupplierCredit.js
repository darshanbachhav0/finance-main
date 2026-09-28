import mongoose from "mongoose";
import { CURRENCY } from "../utils/constants.js";

// A receivable from a supplier, created when a credit note arrives for an invoice that was already
// paid (fully or partly). It is recovered (the supplier refunds the money) or applied against a
// future unpaid invoice from the same supplier. Amounts are in the credit note's currency; the PEN
// value uses the original invoice's rate so the AP/receivable accounts stay consistent.
const movementSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["APPLICATION", "RECOVERY"], required: true },
    amount: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, required: true, min: 0 },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    reference: { type: String, trim: true },
    date: Date,
    journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comments: { type: String, trim: true }
  },
  { _id: true }
);

const supplierCreditSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, index: true },
    supplierIdentifierSnapshot: { type: String, required: true, trim: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    originalAccountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable", required: true },
    originalVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
    creditNoteVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher", required: true, unique: true },
    creditNoteSeriesNumber: { type: String, trim: true, uppercase: true },
    currency: { type: String, enum: CURRENCY, required: true },
    exchangeRate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, required: true, min: 0 },
    remainingAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["OPEN", "PARTIALLY_APPLIED", "SETTLED"], default: "OPEN", index: true },
    originJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    period: { type: String, match: /^\d{4}-\d{2}$/ },
    movements: { type: [movementSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, optimisticConcurrency: true }
);

supplierCreditSchema.index({ supplier: 1, status: 1, currency: 1 });

export default mongoose.model("SupplierCredit", supplierCreditSchema);
