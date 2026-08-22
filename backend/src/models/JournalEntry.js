import mongoose from "mongoose";
import { CURRENCY } from "../utils/constants.js";
import { nextJournalNumber } from "../services/sequenceService.js";
import { moneyEquals, sumMoney } from "../utils/money.js";

const journalLineSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, required: true, trim: true },
    subAccount: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const journalEntrySchema = new mongoose.Schema(
  {
    entryNumber: { type: String, required: true, unique: true, immutable: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    entryType: { type: String, enum: ["PROVISION", "PAYMENT", "ADVANCE", "RENDITION", "RENDITION_SETTLEMENT", "REVERSAL"], required: true },
    sourceTransaction: { type: String, required: true, trim: true },
    currency: { type: String, enum: CURRENCY, required: true },
    originalAmount: { type: Number, required: true, min: 0 },
    exchangeRate: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, required: true, min: 0 },
    lines: {
      type: [journalLineSchema],
      validate: { validator: (lines) => Array.isArray(lines) && lines.length >= 2, message: "A journal requires at least two lines." }
    },
    totalDebit: { type: Number, required: true, min: 0 },
    totalCredit: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["DRAFT", "POSTED", "VOID"], default: "POSTED" },
    postedAt: Date,
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

journalEntrySchema.pre("validate", async function validateBalancedJournal() {
  if (!this.entryNumber) this.entryNumber = await nextJournalNumber(this.postedAt || new Date());
  this.totalDebit = sumMoney((this.lines || []).map((line) => line.debit));
  this.totalCredit = sumMoney((this.lines || []).map((line) => line.credit));
  for (const [index, line] of (this.lines || []).entries()) {
    if ((line.debit > 0 && line.credit > 0) || (line.debit <= 0 && line.credit <= 0)) {
      this.invalidate(`lines.${index}`, "Each journal line must contain either a debit or a credit amount.");
    }
  }
  if (this.totalDebit <= 0 || !moneyEquals(this.totalDebit, this.totalCredit)) {
    this.invalidate("lines", `Journal is not balanced. Debit ${this.totalDebit}, credit ${this.totalCredit}.`);
  }
});

journalEntrySchema.index({ request: 1, entryType: 1, createdAt: 1 });
journalEntrySchema.index(
  { accountsPayable: 1, entryType: 1, sourceTransaction: 1 },
  {
    unique: true,
    partialFilterExpression: { accountsPayable: { $type: "objectId" } },
    name: "journal_ap_entry_source_unique"
  }
);
journalEntrySchema.index({ period: 1, entryType: 1, status: 1 });

export default mongoose.model("JournalEntry", journalEntrySchema);
