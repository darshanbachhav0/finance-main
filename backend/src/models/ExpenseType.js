import mongoose from "mongoose";
import { EXPENSE_NATURES, REQUEST_TYPES } from "../utils/constants.js";

const expenseTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ["OPEX", "CAPEX", "NON_DEDUCTIBLE"], required: true, set: (value) => value === "Non-deductible" ? "NON_DEDUCTIBLE" : value },
    accountingClass: {
      type: String,
      enum: ["CLASS_6", "CLASS_3", "NON_DEDUCTIBLE"],
      required: true,
      set: (value) => ({ "Class 6": "CLASS_6", "Class 3": "CLASS_3", "Account 99": "NON_DEDUCTIBLE" }[value] || value)
    },
    accountNumber: { type: String, required: true, trim: true },
    permittedRequestTypes: [{ type: String, enum: REQUEST_TYPES }],
    permittedExpenseNatures: [{ type: String, enum: EXPENSE_NATURES }],
    deductible: { type: Boolean, default: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

expenseTypeSchema.index({ active: 1, category: 1, accountNumber: 1 });

export default mongoose.model("ExpenseType", expenseTypeSchema);
