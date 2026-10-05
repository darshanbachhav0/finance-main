import mongoose from "mongoose";
import { BUDGET_PLANNING_MODES, validBudgetYear } from "../../../shared/budgetPlanning.mjs";

const monthlyBudgetSchema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12 },
  assignedAmount: { type: Number, min: 0, default: 0 },
  committedAmount: { type: Number, min: 0, default: 0 },
  executedAmount: { type: Number, min: 0, default: 0 },
  paidAmount: { type: Number, min: 0, default: 0 }
}, { _id: false });

const monthChangeSchema = new mongoose.Schema({
  month: { type: Number, min: 1, max: 12, required: true },
  before: Number,
  after: Number
}, { _id: false });

export const BUDGET_ADJUSTMENT_ACTIONS = Object.freeze([
  "CREATED", "TRANSFER", "ALLOCATE_RESERVE", "INCREASE", "EXCEPTION_INCREASE", "CARRY_OVER_OUT", "CARRY_OVER_IN",
  "REDISTRIBUTE", "RELEASE_TO_RESERVE", "DECREASE", "MODE_CHANGE", "ROLL_FORWARD", "SETTINGS"
]);

const adjustmentSchema = new mongoose.Schema({
  operationId: { type: String, required: true },
  // EXCEPTION_INCREASE: shortfall added automatically when Management approved a
  // REQUEST_BUDGET_INCREASE exception. CARRY_OVER_OUT / CARRY_OVER_IN: open commitments moved
  // from one budget year into the next by the year-end carry-over. REDISTRIBUTE: Admin edited the
  // monthly distribution (monthChanges holds every month's before/after). RELEASE_TO_RESERVE /
  // DECREASE: unused money returned to the annual reserve / taken off the year. MODE_CHANGE:
  // annual-only <-> annual + monthly. ROLL_FORWARD: a month's unused budget moved automatically
  // to the next month at month end. SETTINGS: the plan's roll-forward switch was changed.
  action: { type: String, enum: BUDGET_ADJUSTMENT_ACTIONS, required: true },
  amount: Number,
  fromMonth: Number,
  toMonth: Number,
  annualBefore: Number,
  annualAfter: Number,
  monthChanges: { type: [monthChangeSchema], default: undefined },
  modeBefore: String,
  modeAfter: String,
  rollForwardEnabled: Boolean,
  // Months of the change that fall in a closed accounting period (Admin may still edit them).
  closedMonths: { type: [Number], default: undefined },
  // Set when the change needed, and received, Management approval.
  changeRequest: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetPlanChange" },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  approvedByName: String,
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
    // Budget is held per Cost Center only (optionally narrowed by project). Requests draw on it
    // without choosing an expense category; the accounting account is set later by Accounting.
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    project: { type: String, trim: true, default: "" },
    assignedAmount: { type: Number, required: true, min: 0, default: 0 },
    committedAmount: { type: Number, min: 0, default: 0 },
    executedAmount: { type: Number, min: 0, default: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    // Annual + monthly plans only: when a month ends, its unused budget moves to the next month.
    // lastRolledMonth is the last month already handled, so each month end rolls exactly once.
    rollForward: {
      enabled: { type: Boolean, default: false },
      enabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      enabledAt: Date,
      lastRolledMonth: { type: Number, min: 0, max: 12, default: 0 }
    },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

budgetAllocationSchema.pre("validate", function validatePlan() {
  if (this.planningMode === "LEGACY") return;
  if (!validBudgetYear(this.period)) this.invalidate("period", "A valid budget year is required.");
  if (this.months?.length !== 12 || this.months.some((month, index) => month.month !== index + 1)) this.invalidate("months", "A plan must contain January through December in order.");
  const distributed = (this.months || []).reduce((sum, month) => sum + Math.round(month.assignedAmount * 100), 0);
  if (distributed > Math.round(this.assignedAmount * 100)) this.invalidate("months", "Monthly allocations cannot exceed the annual budget.");
});

// The former { period, costCenter, expenseType, project } index ("budget_dimension_unique") is
// dropped by scripts/migrateCostCenterBudgets.js, which also merges the per-expense-type rows.
export const LEGACY_DIMENSION_INDEX = "budget_dimension_unique";
budgetAllocationSchema.index(
  { period: 1, costCenter: 1, project: 1 },
  { unique: true, name: "budget_cost_center_unique" }
);
budgetAllocationSchema.index({ active: 1, period: 1 });

export default mongoose.model("BudgetAllocation", budgetAllocationSchema);
