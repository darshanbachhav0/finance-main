import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import CostCenter from "../models/CostCenter.js";
import { addMoney, subtractMoney } from "../utils/money.js";

export async function budgetOverview(filters = {}) {
  const allocationQuery = { active: true };
  if (filters.period) allocationQuery.period = filters.period;
  if (filters.costCenter) allocationQuery.costCenter = filters.costCenter;
  if (filters.expenseType) allocationQuery.expenseType = filters.expenseType;
  if (filters.project !== undefined) allocationQuery.project = filters.project;
  const commitmentQuery = {};
  if (filters.period) commitmentQuery.period = filters.period;
  const summaryOnly = String(filters.summaryOnly || "").toLowerCase() === "true";
  const [allocations, commitments, exceptions] = await Promise.all([
    BudgetAllocation.find(allocationQuery).populate("costCenter").populate("expenseType").sort({ period: -1, costCenter: 1 }),
    summaryOnly ? [] : BudgetCommitment.find(commitmentQuery)
      .populate("request", "requestNumber requestType status priority requesterArea requestingArea project")
      .populate("lines.costCenter", "code name area budgetMode")
      .populate("lines.expenseType", "code name accountNumber category")
      .populate("lines.budgetException")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 }).limit(500),
    summaryOnly ? [] : BudgetException.find(filters.exceptionStatus ? { status: filters.exceptionStatus } : {})
      .populate("request", "requestNumber requestType status totalPENEquivalent")
      .populate("costCenter", "code name area")
      .populate("expenseType", "code name accountNumber")
      .populate("requestedBy reviewedBy", "name role")
      .sort({ createdAt: -1 }).limit(200)
  ]);

  let rows = allocations.map((allocation) => {
    const available = subtractMoney(subtractMoney(allocation.assignedAmount, allocation.committedAmount), allocation.executedAmount);
    return { ...allocation.toObject(), availableAmount: available, source: "DIMENSIONAL_ALLOCATION" };
  });
  if (!rows.length) {
    const centerQuery = { active: true };
    if (filters.costCenter) centerQuery._id = filters.costCenter;
    if (filters.area) centerQuery.area = filters.area;
    const centers = await CostCenter.find(centerQuery).sort({ code: 1 });
    rows = centers.map((center) => ({
      _id: center._id,
      period: filters.period || "",
      costCenter: center,
      assignedAmount: center.annualBudget,
      committedAmount: center.committedAmount,
      executedAmount: center.executedAmount,
      paidAmount: center.paidAmount,
      availableAmount: center.availableAmount,
      source: "TRANSITIONAL_COST_CENTER"
    }));
  }
  const totals = rows.reduce((result, row) => ({
    assigned: addMoney(result.assigned, row.assignedAmount),
    committed: addMoney(result.committed, row.committedAmount),
    executed: addMoney(result.executed, row.executedAmount),
    paid: addMoney(result.paid, row.paidAmount),
    available: addMoney(result.available, row.availableAmount)
  }), { assigned: 0, committed: 0, executed: 0, paid: 0, available: 0 });
  const warnings = rows.filter((row) => row.availableAmount < 0 || (row.assignedAmount > 0 && row.availableAmount / row.assignedAmount < 0.1)).map((row) => ({
    allocation: row._id,
    costCenter: row.costCenter?._id || row.costCenter,
    code: row.costCenter?.code,
    name: row.costCenter?.name,
    available: row.availableAmount,
    severity: row.availableAmount < 0 ? "OVER_EXECUTION" : "LOW_BALANCE"
  }));
  return { totals, allocations: rows, commitments, exceptions, warnings };
}
