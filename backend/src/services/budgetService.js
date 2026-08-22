import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import { AppError } from "../utils/AppError.js";
import { BUDGET_STATUS, ERROR_CODES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

function dimensionKey(line, project) {
  return [
    String(line.costCenter?._id || line.costCenter),
    String(line.expenseType?._id || line.expenseType),
    String(line.budgetItem || ""),
    String(line.projectId || project || "")
  ].join("|");
}

export function groupBudgetLines(lines = [], project = "") {
  const grouped = new Map();
  for (const line of lines || []) {
    const key = dimensionKey(line, project);
    const current = grouped.get(key) || {
      costCenter: line.costCenter?._id || line.costCenter,
      expenseType: line.expenseType?._id || line.expenseType,
      budgetItem: line.budgetItem || "",
      project: line.projectId || project || "",
      amount: 0
    };
    current.amount = addMoney(current.amount, line.penEquivalent || line.totalAmount || 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((line) => ({ ...line, amount: roundMoney(line.amount) }));
}

export function groupedRequestLines(request) {
  return groupBudgetLines(request.lines || [], request.project);
}

export async function previewBudget(request) {
  const grouped = groupedRequestLines(request);
  if (!grouped.length || !request.accountingPeriod) {
    return { status: "PENDING_VALIDATION", totalRequested: 0, lines: [] };
  }

  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } });
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const lines = [];

  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active || !line.expenseType) {
      lines.push({
        ...line,
        status: "PENDING_VALIDATION",
        costCenterSnapshot: center ? { code: center.code, name: center.name, area: center.area } : undefined
      });
      continue;
    }
    const [rule, allocation] = await Promise.all([
      resolveRule(line, center, request.issueDate),
      findAllocation(request.accountingPeriod, line)
    ]);
    const assigned = roundMoney(allocation?.assignedAmount ?? center.annualBudget ?? 0);
    const committed = roundMoney(allocation?.committedAmount ?? center.committedAmount ?? 0);
    const executed = roundMoney(allocation?.executedAmount ?? center.executedAmount ?? 0);
    const paid = roundMoney(allocation?.paidAmount ?? center.paidAmount ?? 0);
    const available = subtractMoney(subtractMoney(assigned, committed), executed);
    const projectedBalance = subtractMoney(available, line.amount);
    const mode = rule.mode || "TRANSITIONAL";
    lines.push({
      ...line,
      mode,
      exceptionStrategy: rule.exceptionStrategy || "REJECT",
      source: allocation ? "BUDGET_ALLOCATION" : "COST_CENTER",
      allocation: allocation?._id,
      costCenterSnapshot: { code: center.code, name: center.name, area: center.area },
      assigned,
      committed,
      executed,
      paid,
      available,
      projectedBalance,
      status: mode === "TRANSITIONAL" ? "TRANSITIONAL" : projectedBalance >= 0 ? "AVAILABLE" : "INSUFFICIENT"
    });
  }

  const complete = lines.every((line) => line.status !== "PENDING_VALIDATION");
  const insufficient = lines.some((line) => line.status === "INSUFFICIENT");
  return {
    status: !complete ? "PENDING_VALIDATION" : insufficient ? "INSUFFICIENT" : lines.every((line) => line.mode === "TRANSITIONAL") ? "TRANSITIONAL" : "AVAILABLE",
    totalRequested: sumMoney(lines.map((line) => line.amount || 0)),
    totalAvailable: complete ? sumMoney(lines.map((line) => line.available || 0)) : null,
    projectedBalance: complete ? sumMoney(lines.map((line) => line.projectedBalance || 0)) : null,
    lines
  };
}

async function resolveRule(line, center, requestDate) {
  const date = new Date(requestDate || Date.now());
  const rules = await BudgetRule.find({
    active: true,
    $and: [
      { $or: [{ costCenter: line.costCenter }, { costCenter: null }, { costCenter: { $exists: false } }] },
      { $or: [{ expenseType: line.expenseType }, { expenseType: null }, { expenseType: { $exists: false } }] },
      { $or: [{ project: line.project || "" }, { project: "*" }, { project: "" }] },
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: date } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gte: date } }] }
    ]
  }).sort({ costCenter: -1, expenseType: -1, project: -1 }).limit(1);
  return rules[0] || {
    mode: center.budgetMode === "ACTIVE" && Number(center.annualBudget || 0) > 0 ? "ACTIVE" : "TRANSITIONAL",
    exceptionStrategy: "REJECT"
  };
}

async function findAllocation(period, line) {
  const exact = await BudgetAllocation.findOne({
    period,
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    project: line.project || "",
    active: true
  });
  if (exact) return exact;
  return BudgetAllocation.findOne({
    period: period.slice(0, 4),
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    project: line.project || "",
    active: true
  });
}

function insufficientBudgetError(label, available, required, strategy) {
  return new AppError(
    422,
    `${label} has insufficient budget. Available PEN ${available.toFixed(2)}, required PEN ${required.toFixed(2)}.`,
    { available, required, exceptionStrategy: strategy },
    ERROR_CODES.INSUFFICIENT_BUDGET
  );
}

async function releaseApplied(applied, session) {
  for (const item of [...applied].reverse()) {
    if (item.kind === "allocation") {
      await BudgetAllocation.updateOne({ _id: item.id }, { $inc: { committedAmount: -item.amount } }, { session });
    } else {
      await CostCenter.updateOne({ _id: item.id }, { $inc: { committedAmount: -item.amount } }, { session });
    }
  }
}

export async function reserveBudget(request, userId, { session } = {}) {
  const existing = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (existing) return existing;

  const grouped = groupedRequestLines(request);
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const prepared = [];

  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active) {
      throw new AppError(422, "Every request line needs an active Cost Center before budget commitment.", { costCenter: line.costCenter }, ERROR_CODES.VALIDATION_ERROR);
    }
    const [rule, allocation] = await Promise.all([
      resolveRule(line, center, request.issueDate),
      findAllocation(request.accountingPeriod, line)
    ]);
    const mode = rule.mode || "TRANSITIONAL";
    const exceptionStrategy = rule.exceptionStrategy || "REJECT";
    const available = allocation
      ? subtractMoney(subtractMoney(allocation.assignedAmount, allocation.committedAmount), allocation.executedAmount)
      : subtractMoney(subtractMoney(center.annualBudget, center.committedAmount), center.executedAmount);
    if (mode === "ACTIVE" && available < line.amount && exceptionStrategy === "REJECT") {
      throw insufficientBudgetError(allocation ? `${center.code} allocation` : center.code, available, line.amount, exceptionStrategy);
    }
    let budgetException = null;
    let exceptionApproved = false;
    if (mode === "ACTIVE" && available < line.amount) {
      const key = dimensionKey(line, request.project);
      budgetException = await BudgetException.findOne({ request: request._id, dimensionKey: key });
      if (!budgetException) {
        [budgetException] = await BudgetException.create([{
          request: request._id,
          dimensionKey: key,
          costCenter: line.costCenter,
          expenseType: line.expenseType,
          budgetItem: line.budgetItem,
          project: line.project,
          strategy: exceptionStrategy,
          availableAmount: available,
          requestedAmount: line.amount,
          requestedBy: userId
        }]);
      }
      exceptionApproved = exceptionStrategy === "EXTRAORDINARY_APPROVAL" && budgetException.status === "APPROVED";
      if (!exceptionApproved) {
      throw new AppError(
        409,
        `Budget exception ${exceptionStrategy} is required before this request can continue.`,
        { available, required: line.amount, exceptionStrategy, costCenter: center.code, budgetException: budgetException._id, exceptionStatus: budgetException.status },
        ERROR_CODES.INSUFFICIENT_BUDGET
      );
      }
    }
    prepared.push({ ...line, mode, exceptionStrategy, allocation, center, budgetException, exceptionApproved });
  }

  const applied = [];
  try {
    for (const line of prepared.filter((item) => item.mode === "ACTIVE")) {
      if (line.allocation) {
        const allocationQuery = line.exceptionApproved
          ? { _id: line.allocation._id }
          : { _id: line.allocation._id, $expr: { $gte: [{ $subtract: [{ $subtract: ["$assignedAmount", "$committedAmount"] }, "$executedAmount"] }, line.amount] } };
        const updated = await BudgetAllocation.findOneAndUpdate(
          allocationQuery,
          { $inc: { committedAmount: line.amount } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, "Budget allocation changed while reserving funds. Retry the operation.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
        applied.push({ kind: "allocation", id: line.allocation._id, amount: line.amount });
      } else {
        const centerQuery = line.exceptionApproved
          ? { _id: line.center._id }
          : { _id: line.center._id, $expr: { $gte: [{ $subtract: [{ $subtract: ["$annualBudget", { $ifNull: ["$committedAmount", 0] }] }, { $ifNull: ["$executedAmount", 0] }] }, line.amount] } };
        const updated = await CostCenter.findOneAndUpdate(
          centerQuery,
          { $inc: { committedAmount: line.amount } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, `${line.center.code} budget changed while reserving funds. Retry the operation.`, undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
        applied.push({ kind: "costCenter", id: line.center._id, amount: line.amount });
      }
    }

    const status = prepared.some((line) => line.mode === "ACTIVE") ? BUDGET_STATUS.COMMITTED : BUDGET_STATUS.NO_BUDGET;
    const [commitment] = await BudgetCommitment.create([{
      request: request._id,
      requestNumber: request.requestNumber,
      period: request.accountingPeriod,
      lines: prepared.map((line) => ({
        allocation: line.allocation?._id,
        costCenter: line.costCenter,
        expenseType: line.expenseType,
        budgetItem: line.budgetItem,
        project: line.project,
        amount: line.amount,
        mode: line.mode,
        exceptionStrategy: line.exceptionStrategy,
        budgetException: line.budgetException?._id
      })),
      totalAmount: sumMoney(prepared.map((line) => line.amount)),
      status,
      createdBy: userId,
      reservedAt: new Date(),
      history: [{ status, amount: sumMoney(prepared.map((line) => line.amount)), by: userId, comments: "Budget reservation created." }]
    }], session ? { session } : undefined);
    return commitment;
  } catch (error) {
    await releaseApplied(applied, session);
    throw error;
  }
}

function trackedLineAmount(line, field) {
  return roundMoney(Number(line?.[field] || 0));
}

function currentTrackedAmount(commitment, field) {
  const stored = Number(commitment?.[field]);
  if (Number.isFinite(stored) && stored > 0) return roundMoney(stored);
  return sumMoney((commitment?.lines || []).map((line) => trackedLineAmount(line, field)));
}

function allocateAcrossLines(lines, amount, capacityForLine) {
  const target = roundMoney(amount);
  const candidates = lines
    .map((line, index) => ({ line, index, capacity: roundMoney(Math.max(0, capacityForLine(line))) }))
    .filter((item) => item.capacity > 0);
  const totalCapacity = sumMoney(candidates.map((item) => item.capacity));
  if (!candidates.length || target <= 0 || totalCapacity <= 0) return [];
  const bounded = Math.min(target, totalCapacity);
  let allocated = 0;
  return candidates.map((item, candidateIndex) => {
    const isLast = candidateIndex === candidates.length - 1;
    const share = isLast
      ? subtractMoney(bounded, allocated)
      : Math.min(item.capacity, roundMoney(bounded * (item.capacity / totalCapacity)));
    const safeShare = roundMoney(Math.max(0, Math.min(item.capacity, share)));
    allocated = addMoney(allocated, safeShare);
    return { ...item, amount: safeShare };
  }).filter((item) => item.amount > 0);
}

function deriveCommitmentStatus(commitment) {
  const total = roundMoney(commitment.totalAmount || 0);
  const executed = currentTrackedAmount(commitment, "executedAmount");
  const paid = currentTrackedAmount(commitment, "paidAmount");
  if (paid >= total && total > 0) return BUDGET_STATUS.CLOSED;
  if (paid > 0) return BUDGET_STATUS.PARTIALLY_PAID;
  if (executed >= total && total > 0) return BUDGET_STATUS.EXECUTED;
  if (executed > 0) return BUDGET_STATUS.PARTIALLY_EXECUTED;
  return commitment.lines.some((line) => line.mode === "ACTIVE") ? BUDGET_STATUS.COMMITTED : BUDGET_STATUS.NO_BUDGET;
}

async function applyExecutionAllocations(commitment, allocations, session) {
  for (const allocation of allocations) {
    const line = commitment.lines[allocation.index];
    line.executedAmount = addMoney(trackedLineAmount(line, "executedAmount"), allocation.amount);
    if (line.mode !== "ACTIVE") continue;
    const update = { $inc: { committedAmount: -allocation.amount, executedAmount: allocation.amount } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
}

async function applyPaidAllocations(commitment, allocations, session) {
  for (const allocation of allocations) {
    const line = commitment.lines[allocation.index];
    line.paidAmount = addMoney(trackedLineAmount(line, "paidAmount"), allocation.amount);
    if (line.mode !== "ACTIVE") continue;
    const update = { $inc: { paidAmount: allocation.amount } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
}

export async function executeBudgetAmount(request, userId, amount, { session, comments } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED, BUDGET_STATUS.DEFERRED].includes(commitment.status)) return commitment;
  const total = roundMoney(commitment.totalAmount || 0);
  const currentExecuted = currentTrackedAmount(commitment, "executedAmount");
  const requested = roundMoney(amount);
  const amountToExecute = Math.min(Math.max(0, requested), Math.max(0, subtractMoney(total, currentExecuted)));
  if (amountToExecute <= 0) return commitment;

  const allocations = allocateAcrossLines(commitment.lines, amountToExecute, (line) => subtractMoney(line.amount, trackedLineAmount(line, "executedAmount")));
  await applyExecutionAllocations(commitment, allocations, session);
  const applied = sumMoney(allocations.map((item) => item.amount));
  commitment.executedAmount = addMoney(currentExecuted, applied);
  commitment.status = deriveCommitmentStatus(commitment);
  commitment.executedAt = new Date();
  commitment.executedBy = userId;
  commitment.history.push({
    status: commitment.status,
    amount: applied,
    by: userId,
    comments: comments || "Budget execution updated when a validated expense was provisioned."
  });
  await commitment.save({ session });
  return commitment;
}

export async function executeBudget(request, userId, { session, comments } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment) return commitment;
  const remaining = subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "executedAmount"));
  return executeBudgetAmount(request, userId, remaining, { session, comments });
}

export async function markBudgetPaidAmount(request, userId, amount, { session, comments } = {}) {
  let commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED, BUDGET_STATUS.DEFERRED].includes(commitment.status)) return commitment;
  const total = roundMoney(commitment.totalAmount || 0);
  const currentPaid = currentTrackedAmount(commitment, "paidAmount");
  const requested = roundMoney(amount);
  const amountToPay = Math.min(Math.max(0, requested), Math.max(0, subtractMoney(total, currentPaid)));
  if (amountToPay <= 0) return commitment;

  const currentExecuted = currentTrackedAmount(commitment, "executedAmount");
  const requiredExecuted = addMoney(currentPaid, amountToPay);
  if (requiredExecuted > currentExecuted) {
    await executeBudgetAmount(request, userId, subtractMoney(requiredExecuted, currentExecuted), {
      session,
      comments: "Budget execution completed before Treasury payment recognition."
    });
    commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  }

  const allocations = allocateAcrossLines(commitment.lines, amountToPay, (line) => subtractMoney(trackedLineAmount(line, "executedAmount"), trackedLineAmount(line, "paidAmount")));
  await applyPaidAllocations(commitment, allocations, session);
  const applied = sumMoney(allocations.map((item) => item.amount));
  commitment.paidAmount = addMoney(currentPaid, applied);
  commitment.status = deriveCommitmentStatus(commitment);
  commitment.paidAt = new Date();
  commitment.paidBy = userId;
  commitment.history.push({
    status: commitment.status,
    amount: applied,
    by: userId,
    comments: comments || "Budget paid amount updated after Treasury confirmation."
  });
  await commitment.save({ session });
  return commitment;
}

export async function markBudgetPaid(request, userId, { session, comments } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment) return commitment;
  const remaining = subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "paidAmount"));
  return markBudgetPaidAmount(request, userId, remaining, { session, comments });
}

export async function releaseBudget(request, userId, reason, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED].includes(commitment.status)) return commitment;

  for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE")) {
    const remainingCommitted = subtractMoney(line.amount, trackedLineAmount(line, "executedAmount"));
    if (remainingCommitted <= 0) continue;
    const update = { $inc: { committedAmount: -remainingCommitted } };
    if (line.allocation) await BudgetAllocation.updateOne({ _id: line.allocation }, update, { session });
    else await CostCenter.updateOne({ _id: line.costCenter }, update, { session });
  }
  commitment.status = BUDGET_STATUS.RELEASED;
  commitment.releasedAt = new Date();
  commitment.releasedBy = userId;
  commitment.releaseReason = reason;
  commitment.history.push({ status: BUDGET_STATUS.RELEASED, amount: subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "executedAmount")), by: userId, comments: reason });
  await commitment.save({ session });
  return commitment;
}

// Track C advances are recorded without reserving/consuming expense budget. The budget is
// affected only when Finance validates the rendition, as required by the Triple-Track model.
export async function deferBudget(request, userId, { session } = {}) {
  const existing = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (existing) return existing;
  const grouped = groupedRequestLines(request);
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const prepared = [];
  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active) throw new AppError(422, "Every request line needs an active Cost Center.", { costCenter: line.costCenter }, ERROR_CODES.VALIDATION_ERROR);
    const [rule, allocation] = await Promise.all([resolveRule(line, center, request.issueDate), findAllocation(request.accountingPeriod, line)]);
    prepared.push({
      ...line,
      mode: rule.mode || "TRANSITIONAL",
      exceptionStrategy: rule.exceptionStrategy || "REJECT",
      allocation: allocation?._id
    });
  }
  const totalAmount = sumMoney(prepared.map((line) => line.amount));
  const [commitment] = await BudgetCommitment.create([{
    request: request._id,
    requestNumber: request.requestNumber,
    period: request.accountingPeriod,
    lines: prepared,
    totalAmount,
    status: BUDGET_STATUS.DEFERRED,
    createdBy: userId,
    history: [{ status: BUDGET_STATUS.DEFERRED, amount: totalAmount, by: userId, comments: "Track C budget impact deferred until rendition validation." }]
  }], session ? { session } : undefined);
  return commitment;
}

export async function executeDeferredBudget(request, userId, { session, lines } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || commitment.status !== BUDGET_STATUS.DEFERRED) return commitment;

  const grouped = lines ? groupBudgetLines(lines, request.project) : commitment.lines.map((line) => ({
    allocation: line.allocation,
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    budgetItem: line.budgetItem || "",
    project: line.project || "",
    amount: line.amount,
    mode: line.mode,
    exceptionStrategy: line.exceptionStrategy
  }));
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const prepared = [];

  for (const source of grouped) {
    const center = centerMap.get(String(source.costCenter));
    if (!center?.active) throw new AppError(422, "Every rendition line needs an active Cost Center.", { costCenter: source.costCenter }, ERROR_CODES.VALIDATION_ERROR);
    const [rule, allocation] = await Promise.all([
      resolveRule(source, center, request.issueDate),
      findAllocation(request.accountingPeriod, source)
    ]);
    const line = {
      ...source,
      mode: rule.mode || source.mode || "TRANSITIONAL",
      exceptionStrategy: rule.exceptionStrategy || source.exceptionStrategy || "REJECT",
      allocation: allocation?._id || source.allocation
    };
    prepared.push(line);
    if (line.mode !== "ACTIVE" || !(line.amount > 0)) continue;
    if (line.allocation) {
      const updated = await BudgetAllocation.findOneAndUpdate(
        { _id: line.allocation, $expr: { $gte: [{ $subtract: [{ $subtract: ["$assignedAmount", "$committedAmount"] }, "$executedAmount"] }, line.amount] } },
        { $inc: { executedAmount: line.amount, paidAmount: line.amount } },
        { new: true, session }
      );
      if (!updated) throw new AppError(409, "Budget changed before rendition validation.", { amount: line.amount }, ERROR_CODES.INSUFFICIENT_BUDGET);
    } else {
      const updated = await CostCenter.findOneAndUpdate(
        { _id: line.costCenter, $expr: { $gte: [{ $subtract: [{ $subtract: ["$annualBudget", { $ifNull: ["$committedAmount", 0] }] }, { $ifNull: ["$executedAmount", 0] }] }, line.amount] } },
        { $inc: { executedAmount: line.amount, paidAmount: line.amount } },
        { new: true, session }
      );
      if (!updated) throw new AppError(409, "Cost Center budget changed before rendition validation.", { costCenter: line.costCenter, amount: line.amount }, ERROR_CODES.INSUFFICIENT_BUDGET);
    }
  }

  commitment.lines = prepared.map((line) => ({ ...line, executedAmount: line.amount || 0, paidAmount: line.amount || 0 }));
  commitment.totalAmount = sumMoney(prepared.map((line) => line.amount || 0));
  commitment.executedAmount = commitment.totalAmount;
  commitment.paidAmount = commitment.totalAmount;
  commitment.status = BUDGET_STATUS.CLOSED;
  commitment.executedAt = new Date();
  commitment.executedBy = userId;
  commitment.paidAt = new Date();
  commitment.paidBy = userId;
  commitment.history.push({ status: BUDGET_STATUS.EXECUTED, amount: commitment.totalAmount, by: userId, comments: "Track C eligible expense budget executed at rendition validation." });
  commitment.history.push({ status: BUDGET_STATUS.CLOSED, amount: commitment.totalAmount, by: userId, comments: "Track C eligible expense budget closed after rendition validation." });
  await commitment.save({ session });
  return commitment;
}
