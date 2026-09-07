import BudgetAllocation from "../models/BudgetAllocation.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { roundMoney, subtractMoney } from "../utils/money.js";
import { validBudgetPeriod } from "../../../shared/budgetPlanning.mjs";

export const isBudgetPlan = (allocation) => ["ANNUAL_ONLY", "ANNUAL_MONTHLY"].includes(allocation?.planningMode);
export const budgetAvailable = (allocation) => subtractMoney(subtractMoney(allocation?.assignedAmount || 0, allocation?.committedAmount || 0), allocation?.executedAmount || 0);

export async function findBudgetAllocation(period, line, session) {
  const dimension = { costCenter: line.costCenter, expenseType: line.expenseType, project: line.project || "", active: true };
  const annual = await BudgetAllocation.findOne({ ...dimension, period: String(period).slice(0, 4) }).session(session || null);
  // A linked plan is authoritative for all twelve months, including zero allocations.
  if (isBudgetPlan(annual)) return annual;
  return await BudgetAllocation.findOne({ ...dimension, period }).session(session || null) || annual;
}

export function budgetLimits(allocation, period, amount = 0) {
  if (!isBudgetPlan(allocation)) return null;
  if (!validBudgetPeriod(period) || String(period).slice(0, 4) !== allocation.period) throw new AppError(422, "The request needs a valid month within the budget year.", { period }, ERROR_CODES.VALIDATION_ERROR);
  const month = Number(period.slice(5, 7));
  const bucket = allocation.months?.[month - 1];
  if (!bucket || bucket.month !== month) throw new AppError(409, "The monthly budget structure is incomplete.", undefined, ERROR_CODES.CONFLICT);
  const annualAvailable = budgetAvailable(allocation);
  const monthlyAvailable = allocation.planningMode === "ANNUAL_MONTHLY" ? budgetAvailable(bucket) : null;
  return {
    planningMode: allocation.planningMode, budgetMonth: month,
    annualAssigned: allocation.assignedAmount, annualAvailable, annualProjected: subtractMoney(annualAvailable, amount),
    monthlyAssigned: allocation.planningMode === "ANNUAL_MONTHLY" ? bucket.assignedAmount : null,
    monthlyAvailable, monthlyProjected: monthlyAvailable === null ? null : subtractMoney(monthlyAvailable, amount),
    available: monthlyAvailable === null ? annualAvailable : Math.min(annualAvailable, monthlyAvailable)
  };
}

const mongoAvailable = (prefix = "") => ({ $round: [{ $subtract: [{ $subtract: [`$${prefix}assignedAmount`, `$${prefix}committedAmount`] }, `$${prefix}executedAmount`] }, 2] });

// Both limits and both sets of counters are changed in one MongoDB document.
// This also works on the local standalone MongoDB server without transactions.
export async function changeAllocationUsage({ allocation, budgetMonth, increments, required = 0, allowOverrun = false, session }) {
  const query = { _id: allocation };
  const inc = { ...increments };
  if (budgetMonth) {
    const plan = await BudgetAllocation.findById(allocation).session(session || null);
    if (!isBudgetPlan(plan) || plan.months?.[budgetMonth - 1]?.month !== budgetMonth) throw new AppError(409, "The linked budget plan is unavailable.", undefined, ERROR_CODES.CONFLICT);
    query.planningMode = plan.planningMode;
    const prefix = `months.${budgetMonth - 1}.`;
    for (const [key, value] of Object.entries(increments)) inc[`${prefix}${key}`] = value;
    inc.__v = 1;
    if (required > 0) {
      query.active = true;
      if (!allowOverrun) {
        // $arrayElemAt is used because dotted array indices are not aggregation paths.
        const monthlyAvailable = { $let: { vars: { bucket: { $arrayElemAt: ["$months", budgetMonth - 1] } }, in: { $round: [{ $subtract: [{ $subtract: ["$$bucket.assignedAmount", "$$bucket.committedAmount"] }, "$$bucket.executedAmount"] }, 2] } } };
        query.$expr = { $and: [{ $gte: [mongoAvailable(), required] }, ...(plan.planningMode === "ANNUAL_MONTHLY" ? [{ $gte: [monthlyAvailable, required] }] : [])] };
      }
    }
  } else if (required > 0 && !allowOverrun) query.$expr = { $gte: [mongoAvailable(), required] };
  const updated = await BudgetAllocation.findOneAndUpdate(query, { $inc: inc }, { new: true, session });
  if (!updated) throw new AppError(409, "Budget availability changed. Refresh and retry the operation.", { allocation, budgetMonth, required: roundMoney(required) }, ERROR_CODES.INSUFFICIENT_BUDGET);
  return updated;
}
