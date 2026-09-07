import mongoose from "mongoose";
import { BUDGET_PLANNING_MODES, validBudgetYear } from "../../../shared/budgetPlanning.mjs";

const monthlyBudgetSchema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12 },
  assignedAmount: { type: Number, min: 0, default: 0 },
  committedAmount: { type: Number, min: 0, default: 0 },
  executedAmount: { type: Number, min: 0, default: 0 },
  paidAmount: { type: Number, min: 0, default: 0 }
}, { _id: false });

const adjustmentSchema = new mongoose.Schema({
  operationId: { type: String, required: true },
  action: { type: String, enum: ["CREATED", "TRANSFER", "ALLOCATE_RESERVE", "INCREASE"], required: true },
  amount: Number,
  fromMonth: Number,
  toMonth: Number,
  annualBefore: Number,
  annualAfter: Number,
  reason: { type: String, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actorName: String,
  at: { type: Date, default: Date.now }
}, { _id: false });

const budgetAllocationSchema = new mongoose.Schema(
  {
    period: { type: String, required: true, match: /^\d{4}(-\d{2})?$/ },
    planningMode: { type: String, enum: ["LEGACY", ...Object.keys(BUDGET_PLANNING_MODES)], default: "LEGACY" },
    months: { type: [monthlyBudgetSchema], default: undefined },
    adjustments: { type: [adjustmentSchema], default: undefined },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    project: { type: String, trim: true, default: "" },
    assignedAmount: { type: Number, required: true, min: 0, default: 0 },
    committedAmount: { type: Number, min: 0, default: 0 },
    executedAmount: { type: Number, min: 0, default: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

budgetAllocationSchema.pre("validate", function validatePlan() {
  if (this.planningMode === "LEGACY") return;
  if (!validBudgetYear(this.period)) this.invalidate("period", "A valid budget year is required.");
  if (!this.expenseType) this.invalidate("expenseType", "Select an expense account.");
  if (this.months?.length !== 12 || this.months.some((month, index) => month.month !== index + 1)) this.invalidate("months", "A plan must contain January through December in order.");
  const distributed = (this.months || []).reduce((sum, month) => sum + Math.round(month.assignedAmount * 100), 0);
  if (distributed > Math.round(this.assignedAmount * 100)) this.invalidate("months", "Monthly allocations cannot exceed the annual budget.");
});

budgetAllocationSchema.index(
  { period: 1, costCenter: 1, expenseType: 1, project: 1 },
  { unique: true, name: "budget_dimension_unique" }
);
budgetAllocationSchema.index({ active: 1, period: 1 });

export default mongoose.model("BudgetAllocation", budgetAllocationSchema);
