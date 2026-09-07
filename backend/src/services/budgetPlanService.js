import crypto from "node:crypto";
import mongoose from "mongoose";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { recordAudit } from "./auditService.js";
import { budgetAvailable, isBudgetPlan } from "./budgetAllocationService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { addMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { BUDGET_PLANNING_MODES, budgetCents, distributeAnnualBudget, validBudgetYear } from "../../../shared/budgetPlanning.mjs";

function assertManager(user) {
  if (!["Admin", "Budget"].includes(user?.role)) throw new AppError(403, "Only Budget or Admin can manage budget plans.", undefined, ERROR_CODES.FORBIDDEN);
}
const invalid = (message, details) => new AppError(422, message, details, ERROR_CODES.VALIDATION_ERROR);
function amount(value) {
  try { return budgetCents(value) / 100; } catch (error) { throw invalid(error.message); }
}
function reason(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw invalid("A reason of at most 2000 characters is required.");
  return value.trim();
}
function month(value) {
  const number = Number(value);
  if (!["string", "number"].includes(typeof value) || !Number.isInteger(number) || number < 1 || number > 12) throw invalid("Select a valid month.");
  return number;
}
function operationId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw invalid("A valid adjustment identifier is required.");
  return value;
}

export function serializeBudgetPlan(plan) {
  const value = plan.toObject ? plan.toObject() : plan;
  return {
    ...value,
    availableAmount: budgetAvailable(value),
    distributedAmount: sumMoney((value.months || []).map((bucket) => bucket.assignedAmount)),
    unallocatedAmount: value.planningMode === "ANNUAL_MONTHLY" ? subtractMoney(value.assignedAmount, sumMoney(value.months.map((bucket) => bucket.assignedAmount))) : null,
    months: (value.months || []).map((bucket) => ({ ...bucket, availableAmount: value.planningMode === "ANNUAL_MONTHLY" ? budgetAvailable(bucket) : null }))
  };
}

export async function getBudgetPlan(id) {
  if (!mongoose.isValidObjectId(id)) throw invalid("Select a valid budget plan.");
  const plan = await BudgetAllocation.findById(id).populate("costCenter expenseType");
  if (!isBudgetPlan(plan)) throw new AppError(404, "Budget plan not found.", undefined, ERROR_CODES.NOT_FOUND);
  return serializeBudgetPlan(plan);
}

export async function createBudgetPlan(payload, user, req) {
  assertManager(user);
  if (!validBudgetYear(payload.year)) throw invalid("Enter a budget year between 2000 and 2199.");
  if (!Object.hasOwn(BUDGET_PLANNING_MODES, payload.planningMode)) throw invalid("Select a valid budget planning mode.");
  if (!mongoose.isValidObjectId(payload.costCenter) || !mongoose.isValidObjectId(payload.expenseType)) throw invalid("Select a Cost Center and expense account.");
  if (payload.project !== undefined && (typeof payload.project !== "string" || payload.project.length > 150)) throw invalid("Enter a project of at most 150 characters.");
  const project = (payload.project || "").trim();
  const annual = amount(payload.assignedAmount);
  if (annual <= 0) throw invalid("The annual budget must be greater than zero.");
  const notes = reason(payload.reason);
  const [center, expense] = await Promise.all([CostCenter.findById(payload.costCenter), ExpenseType.findById(payload.expenseType)]);
  if (!center?.active || !expense?.active) throw invalid("Select an active Cost Center and expense account.");
  const dimension = { costCenter: center._id, expenseType: expense._id, project };
  const year = String(payload.year);
  const existing = await BudgetAllocation.findOne({ ...dimension, period: new RegExp(`^${year}(?:-|$)`) });
  if (existing) throw new AppError(409, "An allocation already exists for this year and dimension. Existing allocations remain unchanged; choose another year or dimension.", { allocation: existing._id }, ERROR_CODES.CONFLICT);
  const historical = await BudgetCommitment.exists({ period: new RegExp(`^${year}-`), lines: { $elemMatch: { costCenter: center._id, expenseType: expense._id, project: project || { $in: ["", null] } } } });
  if (historical) throw new AppError(409, "This dimension already has budget activity in the selected year. Create a plan for a new year to preserve its recorded usage.", undefined, ERROR_CODES.CONFLICT);
  let distributed = Array(12).fill(0);
  if (payload.planningMode === "ANNUAL_MONTHLY") {
    if (payload.distribution === "EQUAL") distributed = distributeAnnualBudget(annual);
    else if (payload.distribution === "CUSTOM" && Array.isArray(payload.months) && payload.months.length === 12) distributed = payload.months.map(amount);
    else throw invalid("Choose equal distribution or enter all twelve monthly amounts.");
    if (sumMoney(distributed) > annual) throw invalid("Monthly allocations cannot exceed the annual budget.");
  }
  const adjustment = { operationId: crypto.randomUUID(), action: "CREATED", annualBefore: 0, annualAfter: annual, amount: annual, reason: notes, by: user._id, actorName: user.name };
  let plan;
  try {
    plan = await BudgetAllocation.create({ ...dimension, period: year, planningMode: payload.planningMode, assignedAmount: annual, months: distributed.map((assignedAmount, index) => ({ month: index + 1, assignedAmount })), adjustments: [adjustment] });
  } catch (error) {
    if (error.code === 11000) throw new AppError(409, "A budget already exists for this year and dimension.", undefined, ERROR_CODES.CONFLICT);
    throw error;
  }
  await recordAudit({ entityType: "BudgetAllocation", entity: plan, action: "PLAN_CREATED", module: "BUDGET", period: year, user, req, comments: notes, newValues: serializeBudgetPlan(plan) });
  return getBudgetPlan(plan._id);
}

export async function adjustBudgetPlan(id, payload, user, req) {
  assertManager(user);
  if (!mongoose.isValidObjectId(id)) throw invalid("Select a valid budget plan.");
  const plan = await BudgetAllocation.findById(id);
  if (!isBudgetPlan(plan) || !plan.active) throw new AppError(404, "Budget plan not found.", undefined, ERROR_CODES.NOT_FOUND);
  const key = operationId(payload.operationId);
  if (plan.adjustments.some((entry) => entry.operationId === key)) return getBudgetPlan(id);
  if (!Number.isInteger(payload.revision) || payload.revision !== plan.__v) throw new AppError(409, "The budget changed. Refresh it before making an adjustment.", undefined, ERROR_CODES.CONFLICT);
  const notes = reason(payload.reason);
  const value = amount(payload.amount);
  if (value <= 0) throw invalid("The adjustment amount must be greater than zero.");
  const action = payload.action;
  if (!["TRANSFER", "ALLOCATE_RESERVE", "INCREASE"].includes(action)) throw invalid("Select a valid budget adjustment.");
  if (action !== "INCREASE" && plan.planningMode !== "ANNUAL_MONTHLY") throw invalid("Monthly adjustments require monthly budget control.");
  const increments = { __v: 1 };
  const entry = { operationId: key, action, amount: value, annualBefore: plan.assignedAmount, annualAfter: plan.assignedAmount, reason: notes, by: user._id, actorName: user.name, at: new Date() };
  if (action === "INCREASE") {
    entry.annualAfter = addMoney(plan.assignedAmount, value);
    amount(entry.annualAfter);
    increments.assignedAmount = value;
  } else {
    const to = month(payload.toMonth);
    entry.toMonth = to;
    increments[`months.${to - 1}.assignedAmount`] = value;
    if (action === "TRANSFER") {
      const from = month(payload.fromMonth);
      if (from === to) throw invalid("Choose two different months.");
      if (budgetAvailable(plan.months[from - 1]) < value) throw invalid("The source month has insufficient uncommitted budget.");
      entry.fromMonth = from;
      increments[`months.${from - 1}.assignedAmount`] = -value;
    } else if (serializeBudgetPlan(plan).unallocatedAmount < value) throw invalid("The annual reserve is insufficient for this allocation.");
  }
  const updated = await BudgetAllocation.findOneAndUpdate({ _id: id, __v: payload.revision, "adjustments.operationId": { $ne: key } }, { $inc: increments, $push: { adjustments: entry } }, { new: true });
  if (!updated) {
    const current = await BudgetAllocation.findById(id);
    if (current?.adjustments?.some((change) => change.operationId === key)) return getBudgetPlan(id);
    throw new AppError(409, "The budget changed. Refresh it before making an adjustment.", undefined, ERROR_CODES.CONFLICT);
  }
  // The authoritative adjustment history is committed atomically with the amounts.
  await recordAudit({ entityType: "BudgetAllocation", entity: updated, action, module: "BUDGET", period: plan.period, user, req, comments: notes, oldValues: { assignedAmount: plan.assignedAmount }, newValues: entry });
  return getBudgetPlan(id);
}

// Generic master-data CRUD cannot bypass linked-plan limits or erase its history.
export async function assertLegacyAllocationChange(payload, current) {
  if (isBudgetPlan(current)) throw new AppError(409, "Manage this linked budget through Budget Control and its audited adjustments.", undefined, ERROR_CODES.CONFLICT);
  const candidate = { ...(current?.toObject?.() || {}), ...payload };
  const year = String(candidate.period || "").slice(0, 4);
  if (!validBudgetYear(year)) throw invalid("Enter a valid budget year or month.");
  const plan = await BudgetAllocation.exists({ period: year, costCenter: candidate.costCenter, expenseType: candidate.expenseType, project: candidate.project || "", planningMode: { $in: Object.keys(BUDGET_PLANNING_MODES) } });
  if (plan) throw new AppError(409, "A linked annual budget already controls this dimension. Use Budget Control to adjust it.", undefined, ERROR_CODES.CONFLICT);
}
