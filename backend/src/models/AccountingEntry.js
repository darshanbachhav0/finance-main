import mongoose from "mongoose";
import { CURRENCY } from "../utils/constants.js";

const accountingEntrySchema = new mongoose.Schema(
  {
    entryNumber: { type: String, unique: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    accountNumber: { type: String, required: true },
    description: { type: String, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    originalAmount: { type: Number, default: 0 },
    exchangeRate: { type: Number, default: 1 },
    status: { type: String, enum: ["DRAFT", "POSTED", "VOID"], default: "POSTED" },
    type: { type: String, enum: ["PROVISION", "PAYMENT", "RENDITION"], required: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

accountingEntrySchema.pre("validate", function beforeValidate(next) {
  if (!this.entryNumber) {
    this.entryNumber = `ACC-${Date.now().toString().slice(-8)}-${Math.round(Math.random() * 999)}`;
  }
  next();
});

accountingEntrySchema.index({ request: 1, type: 1 });
accountingEntrySchema.index({ period: 1, costCenter: 1, expenseType: 1 });

const AccountingEntry = mongoose.model("AccountingEntry", accountingEntrySchema);
export default AccountingEntry;
