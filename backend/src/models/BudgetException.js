import mongoose from "mongoose";

const budgetExceptionSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    dimensionKey: { type: String, required: true },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    budgetItem: String,
    project: String,
    strategy: { type: String, enum: ["REQUEST_BUDGET_INCREASE", "EXTRAORDINARY_APPROVAL"], required: true },
    availableAmount: { type: Number, required: true },
    budgetLimits: {
      planningMode: String,
      budgetMonth: Number,
      annualAvailable: Number,
      annualProjected: Number,
      monthlyAvailable: Number,
      monthlyProjected: Number
    },
    requestedAmount: { type: Number, required: true },
    // RESOLVED: the exception became moot without a decision (the commitment later succeeded
    // within budget, or the request was voided), so it no longer blocks closure or counts as work.
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "RESOLVED"], default: "PENDING", index: true },
    // A resubmitted request whose previous exception was REJECTED, or APPROVED but exceeded
    // again, gets a new exception record that points back at the stale one.
    supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetException" },
    resolvedAt: Date,
    resolutionReason: String,
    // REQUEST_BUDGET_INCREASE approvals add the shortfall to the budget automatically.
    appliedIncrease: {
      target: { type: String, enum: ["BUDGET_PLAN", "BUDGET_ALLOCATION", "COST_CENTER"] },
      allocation: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetAllocation" },
      costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
      budgetMonth: Number,
      amount: Number,
      appliedAt: Date,
      appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    preparedAt: Date,
    preparationComments: String,
    history: [{ action: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: { type: Date, default: Date.now }, comments: String }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    comments: String
  },
  { timestamps: true }
);

// At most one OPEN (PENDING) exception per request dimension. Decided or resolved exceptions
// stay as history, so a resubmission can open a fresh one. The former unconditional unique
// index on { request, dimensionKey } is dropped on first conflict (LEGACY_EXCEPTION_INDEX).
export const LEGACY_EXCEPTION_INDEX = "request_1_dimensionKey_1";
budgetExceptionSchema.index({ request: 1, dimensionKey: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" }, name: "budget_exception_open_unique" });
budgetExceptionSchema.index({ status: 1, strategy: 1, createdAt: -1 });

export default mongoose.model("BudgetException", budgetExceptionSchema);
