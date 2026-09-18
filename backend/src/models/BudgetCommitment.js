import mongoose from "mongoose";
import { BUDGET_STATUS } from "../utils/constants.js";

const commitmentHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(BUDGET_STATUS), required: true },
    amount: { type: Number, min: 0 },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comments: String
  },
  { _id: true }
);

const commitmentLineSchema = new mongoose.Schema(
  {
    allocation: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetAllocation" },
    budgetMonth: { type: Number, min: 1, max: 12 },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType", required: true },
    budgetItem: String,
    project: String,
    amount: { type: Number, required: true, min: 0 },
    executedAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    mode: { type: String, enum: ["TRANSITIONAL", "ACTIVE"], required: true },
    exceptionStrategy: String,
    budgetException: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetException" }
  },
  { _id: false }
);

const budgetCommitmentSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    requestNumber: { type: String, required: true },
    period: { type: String, required: true },
    lines: { type: [commitmentLineSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    executedAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: Object.values(BUDGET_STATUS), required: true, default: BUDGET_STATUS.AVAILABLE },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reservedAt: Date,
    executedAt: Date,
    executedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    releasedAt: Date,
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    releaseReason: String,
    legacyUnreservedSnapshot: mongoose.Schema.Types.Mixed,
    renditionReservationSnapshot: mongoose.Schema.Types.Mixed,
    adjustments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    history: { type: [commitmentHistorySchema], default: [] }
  },
  { timestamps: true, optimisticConcurrency: true }
);

budgetCommitmentSchema.index({ status: 1, period: 1 });

export default mongoose.model("BudgetCommitment", budgetCommitmentSchema);
