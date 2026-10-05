import mongoose from "mongoose";

// A budget plan change that moves more money than the configured approval threshold
// (FinanceConfiguration BUDGET_CHANGE_APPROVAL_THRESHOLD). Admin requests it; it applies to the
// plan only when Management approves it, after every rule is checked again on the plan as it is
// then. Changes under the threshold apply immediately and never create one of these.
const budgetPlanChangeSchema = new mongoose.Schema(
  {
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetAllocation", required: true, index: true },
    operationId: { type: String, required: true, unique: true },
    action: { type: String, required: true },
    // The normalized change (amount, months, planningMode, ...), replayed when approved.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    // Money the change moves; this is what is compared with the threshold.
    amount: { type: Number, min: 0, required: true },
    threshold: Number,
    summary: { type: String, trim: true },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedByName: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedByName: String,
    decidedAt: Date,
    decisionComments: { type: String, trim: true },
    appliedAt: Date
  },
  { timestamps: true }
);

budgetPlanChangeSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("BudgetPlanChange", budgetPlanChangeSchema);
