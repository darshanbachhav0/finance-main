import mongoose from "mongoose";

const budgetAllocationSchema = new mongoose.Schema(
  {
    period: { type: String, required: true, match: /^\d{4}(-\d{2})?$/ },
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

budgetAllocationSchema.index(
  { period: 1, costCenter: 1, expenseType: 1, project: 1 },
  { unique: true, name: "budget_dimension_unique" }
);
budgetAllocationSchema.index({ active: 1, period: 1 });

export default mongoose.model("BudgetAllocation", budgetAllocationSchema);

