import mongoose from "mongoose";
import { BUDGET_EXCEPTION_STRATEGIES, BUDGET_MODES, ROLES } from "../utils/constants.js";

const budgetRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mode: { type: String, enum: BUDGET_MODES, default: "TRANSITIONAL" },
    exceptionStrategy: { type: String, enum: BUDGET_EXCEPTION_STRATEGIES, default: "REJECT" },
    // Who may authorize an EXTRAORDINARY_APPROVAL exception for this dimension. Budget prepares
    // exceptions; only Management/Rectorate authority may decide them - Admin must never approve
    // a financial exception on Management's behalf, so the enum deliberately excludes every other
    // role (including Admin and Budget itself) rather than trusting free-form configuration.
    exceptionApproverRole: { type: String, enum: [ROLES.MANAGEMENT], default: ROLES.MANAGEMENT },
    // Optional graduated authority: above this PEN amount, a different (presumably higher)
    // authority is required instead of exceptionApproverRole. Same restriction applies.
    exceptionEscalationAmount: { type: Number, min: 0 },
    exceptionEscalationApproverRole: { type: String, enum: [ROLES.MANAGEMENT] },
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

