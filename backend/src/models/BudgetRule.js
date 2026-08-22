import mongoose from "mongoose";
import { BUDGET_EXCEPTION_STRATEGIES, BUDGET_MODES } from "../utils/constants.js";

const budgetRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mode: { type: String, enum: BUDGET_MODES, default: "TRANSITIONAL" },
    exceptionStrategy: { type: String, enum: BUDGET_EXCEPTION_STRATEGIES, default: "REJECT" },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    project: { type: String, trim: true, default: "*" },
    active: { type: Boolean, default: true },
    effectiveFrom: Date,
    effectiveTo: Date
  },
  { timestamps: true }
);

budgetRuleSchema.index({ active: 1, costCenter: 1, expenseType: 1, project: 1 });

export default mongoose.model("BudgetRule", budgetRuleSchema);

