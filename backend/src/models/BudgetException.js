import mongoose from "mongoose";

const budgetExceptionSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    dimensionKey: { type: String, required: true },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    budgetItem: String,
    project: String,
    strategy: { type: String, enum: ["REQUEST_BUDGET_INCREASE", "EXTRAORDINARY_APPROVAL"], required: true },
    availableAmount: { type: Number, required: true },
    requestedAmount: { type: Number, required: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    comments: String
  },
  { timestamps: true }
);

budgetExceptionSchema.index({ request: 1, dimensionKey: 1 }, { unique: true });
budgetExceptionSchema.index({ status: 1, strategy: 1, createdAt: -1 });

export default mongoose.model("BudgetException", budgetExceptionSchema);

