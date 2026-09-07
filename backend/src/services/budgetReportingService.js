import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import FinancialRequest from "../models/FinancialRequest.js";
import CostCenter from "../models/CostCenter.js";
import { budgetAvailable, isBudgetPlan } from "./budgetAllocationService.js";
import { addMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { validBudgetPeriod, validBudgetYear } from "../../../shared/budgetPlanning.mjs";
import { AppError } from "../utils/AppError.js";

export function budgetPeriodFilter(period) {
  if (!period) return undefined;
  if (validBudgetYear(period)) return new RegExp(`^${period}(?:-|$)`);
  if (validBudgetPeriod(period)) return period;
  throw new AppError(422, "Select a valid budget year or month.");
}

export async function budgetAllocationRows(filters = {}) {
  budgetPeriodFilter(filters.period);
  const query = { active: true };
  if (filters.period) query.period = new RegExp(`^${String(filters.period).slice(0, 4)}(?:-|$)`);
  if (filters.costCenter) query.costCenter = filters.costCenter;
  if (filters.expenseType) query.expenseType = filters.expenseType;
  if (filters.project) query.project = filters.project;
  const documents = await BudgetAllocation.find(query).select("-adjustments").populate("costCenter expenseType").sort({ period: -1, createdAt: -1 }).lean();
  const monthly = Boolean(filters.period && validBudgetPeriod(filters.period));
  const month = monthly ? Number(filters.period.slice(5)) : null;
  const rows = [];
  const legacyGroups = new Map();
  for (const allocation of documents) {
    if (isBudgetPlan(allocation)) {
      const bucket = monthly ? allocation.months[month - 1] : allocation;
      const limited = !monthly || allocation.planningMode === "ANNUAL_MONTHLY";
      rows.push({ ...allocation, planYear: allocation.period, period: monthly ? filters.period : allocation.period,
        assignedAmount: limited ? bucket.assignedAmount : null, committedAmount: bucket.committedAmount, executedAmount: bucket.executedAmount, paidAmount: bucket.paidAmount,
        availableAmount: limited ? budgetAvailable(bucket) : null, annualAvailable: budgetAvailable(allocation), annualAssigned: allocation.assignedAmount,
        unallocatedAmount: allocation.planningMode === "ANNUAL_MONTHLY" ? subtractMoney(allocation.assignedAmount, sumMoney(allocation.months.map((entry) => entry.assignedAmount))) : null,
        source: "LINKED_ANNUAL_PLAN", reportingScope: limited ? "PERIOD" : "ANNUAL_ONLY_ACTIVITY" });
    } else {
      const key = [allocation.period.slice(0, 4), allocation.costCenter?._id, allocation.expenseType?._id, allocation.project || ""].join("|");
      legacyGroups.set(key, [...(legacyGroups.get(key) || []), allocation]);
    }
  }
  for (const group of legacyGroups.values()) {
    const annual = group.find((entry) => entry.period.length === 4);
    if (monthly) {
      const exact = group.find((entry) => entry.period === filters.period);
      if (exact) rows.push({ ...exact, availableAmount: budgetAvailable(exact), source: "DIMENSIONAL_ALLOCATION", reportingScope: "PERIOD" });
      else if (annual) rows.push({ ...annual, assignedAmount: null, committedAmount: null, executedAmount: null, paidAmount: null, availableAmount: null, annualAssigned: annual.assignedAmount, annualAvailable: budgetAvailable(annual), source: "DIMENSIONAL_ALLOCATION", reportingScope: "ANNUAL_FALLBACK" });
    } else {
      const assigned = annual?.assignedAmount ?? sumMoney(group.map((entry) => entry.assignedAmount));
      const row = { ...(annual || group[0]), period: group[0].period.slice(0, 4), assignedAmount: assigned, committedAmount: sumMoney(group.map((entry) => entry.committedAmount)), executedAmount: sumMoney(group.map((entry) => entry.executedAmount)), paidAmount: sumMoney(group.map((entry) => entry.paidAmount)), source: "DIMENSIONAL_ALLOCATION", reportingScope: "PERIOD" };
      rows.push({ ...row, availableAmount: budgetAvailable(row) });
    }
  }
  if (!documents.length) {
    const centerQuery = { active: true };
    if (filters.costCenter) centerQuery._id = filters.costCenter;
    for (const center of await CostCenter.find(centerQuery).lean()) rows.push({ _id: center._id, period: "", costCenter: center, assignedAmount: center.annualBudget, committedAmount: center.committedAmount, executedAmount: center.executedAmount, paidAmount: center.paidAmount, availableAmount: subtractMoney(subtractMoney(center.annualBudget, center.committedAmount), center.executedAmount), source: "TRANSITIONAL_COST_CENTER", reportingScope: "UNDATED_LEGACY" });
  }
  return rows.filter((row) => (!filters.source || row.source === filters.source) && (!filters.search || `${row.costCenter?.code} ${row.costCenter?.name} ${row.expenseType?.name} ${row.expenseType?.accountNumber} ${row.project} ${row.period}`.toLowerCase().includes(String(filters.search).toLowerCase())));
}

export async function budgetOverview(filters = {}) {
  const rows = await budgetAllocationRows(filters);
  const totals = rows.filter((row) => !["UNDATED_LEGACY", "ANNUAL_FALLBACK"].includes(row.reportingScope)).reduce((result, row) => ({
    assigned: addMoney(result.assigned, row.assignedAmount || 0), committed: addMoney(result.committed, row.committedAmount || 0), executed: addMoney(result.executed, row.executedAmount || 0), paid: addMoney(result.paid, row.paidAmount || 0), available: addMoney(result.available, row.availableAmount || 0)
  }), { assigned: 0, committed: 0, executed: 0, paid: 0, available: 0 });
  const warnings = rows.filter((row) => row.availableAmount !== null && (row.availableAmount < 0 || (row.assignedAmount > 0 && row.availableAmount / row.assignedAmount < .1))).map((row) => ({ allocation: row._id, costCenter: row.costCenter?._id, code: row.costCenter?.code, name: row.costCenter?.name, available: row.availableAmount, severity: row.availableAmount < 0 ? "OVER_EXECUTION" : "LOW_BALANCE" }));
  let commitments = [], exceptions = [];
  if (String(filters.summaryOnly) !== "true") {
    const period = budgetPeriodFilter(filters.period);
    const requests = period ? await FinancialRequest.find({ accountingPeriod: period }).distinct("_id") : null;
    [commitments, exceptions] = await Promise.all([
      BudgetCommitment.find(period ? { period } : {}).populate("request lines.costCenter lines.expenseType createdBy").sort({ createdAt: -1 }).limit(500),
      BudgetException.find({ ...(requests ? { request: { $in: requests } } : {}), ...(filters.exceptionStatus ? { status: filters.exceptionStatus } : {}) }).populate("request costCenter expenseType requestedBy reviewedBy").sort({ createdAt: -1 }).limit(200)
    ]);
  }
  return { totals, allocations: rows, commitments, exceptions, warnings,
    hasUndatedLegacy: rows.some((row) => row.reportingScope === "UNDATED_LEGACY"),
    hasAnnualOnlyActivity: rows.some((row) => ["ANNUAL_ONLY_ACTIVITY", "ANNUAL_FALLBACK"].includes(row.reportingScope)) };
}
