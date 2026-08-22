import mongoose from "mongoose";
import { CURRENCY, EXPENSE_NATURES, REQUEST_TYPES } from "../utils/constants.js";

const accountingMappingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    purpose: {
      type: String,
      enum: ["EXPENSE", "ASSET", "NON_DEDUCTIBLE", "ACCOUNTS_PAYABLE", "BANK", "ADVANCE_TRANSIT", "IGV", "RETURN_RECEIVABLE"],
      required: true
    },
    requestType: { type: String, enum: ["*", ...REQUEST_TYPES], default: "*" },
    expenseNature: { type: String, enum: ["*", ...EXPENSE_NATURES], default: "*" },
    bank: { type: String, trim: true, uppercase: true, default: "*" },
    currency: { type: String, enum: ["*", ...CURRENCY], default: "*" },
    accountNumber: { type: String, required: true, trim: true },
    subAccount: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

accountingMappingSchema.index({ active: 1, purpose: 1, requestType: 1, expenseNature: 1, bank: 1, currency: 1 });

export default mongoose.model("AccountingMapping", accountingMappingSchema);
