import BudgetCommitment from "../models/BudgetCommitment.js";
import AccountsPayable from "../models/AccountsPayable.js";
import BudgetException, { LEGACY_EXCEPTION_INDEX } from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import { recordAudit } from "./auditService.js";
import CostCenter from "../models/CostCenter.js";
import { AppError } from "../utils/AppError.js";
import { BUDGET_STATUS, ERROR_CODES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { budgetLimits, changeAllocationUsage, findBudgetAllocation as findAllocation, isBudgetPlan } from "./budgetAllocationService.js";

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
  const previewSources = new Map();

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
    const sourceKey = String(allocation?._id || center._id);
    const requested = addMoney(previewSources.get(sourceKey)?.requested || 0, line.amount);
    const limits = budgetLimits(allocation, request.accountingPeriod, requested);
    const available = limits?.available ?? subtractMoney(subtractMoney(assigned, committed), executed);
    const projectedBalance = subtractMoney(available, requested);
    previewSources.set(sourceKey, { available, requested, projectedBalance });
    // Preview and posting use the same explicit control mode, including zero budgets.
    const mode = isBudgetPlan(allocation) ? "ACTIVE" : rule.mode || "TRANSITIONAL";
    lines.push({
      ...line,
      mode,
      exceptionStrategy: rule.exceptionStrategy || "REJECT",
      source: allocation ? "BUDGET_ALLOCATION" : "COST_CENTER",
      allocation: allocation?._id,
      ...limits,
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
    totalAvailable: complete ? sumMoney([...previewSources.values()].map((line) => line.available)) : null,
    projectedBalance: complete ? sumMoney([...previewSources.values()].map((line) => line.projectedBalance)) : null,
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
    mode: center.budgetMode === "ACTIVE" ? "ACTIVE" : "TRANSITIONAL",
    exceptionStrategy: "REJECT"
  };
}

function insufficientBudgetError(label, available, required, strategy, limits) {
  return new AppError(
    422,
    `${label} has insufficient budget. Available PEN ${available.toFixed(2)}, required PEN ${required.toFixed(2)}.`,
    { available, required, exceptionStrategy: strategy, ...limits },
    ERROR_CODES.INSUFFICIENT_BUDGET
  );
}

// A previous exception for the same request dimension can only be reused while it is still
// PENDING, or when it is an APPROVED extraordinary overrun at least as large as today's need.
// A REJECTED exception, an APPROVED one that is now exceeded, or an approved budget increase
// that was consumed elsewhere is stale: the resubmission gets a fresh exception instead.
function exceptionStillUsable(exception, strategy, amount) {
  if (exception.status === "PENDING") return true;
  return exception.status === "APPROVED" && exception.strategy === "EXTRAORDINARY_APPROVAL"
    && strategy === "EXTRAORDINARY_APPROVAL" && roundMoney(amount) <= roundMoney(exception.requestedAmount);
}

let legacyExceptionIndexChecked = false;
async function dropLegacyExceptionIndex() {
  if (legacyExceptionIndexChecked) return;
  const indexes = await BudgetException.collection.indexes().catch(() => []);
  if (indexes.some((index) => index.name === LEGACY_EXCEPTION_INDEX)) await BudgetException.collection.dropIndex(LEGACY_EXCEPTION_INDEX);
  legacyExceptionIndexChecked = true;
}

export async function findOrOpenBudgetException({ request, key, line, strategy, available, amount, limits, userId, comments, session }) {
  const latest = await BudgetException.findOne({ request: request._id, dimensionKey: key }).sort({ createdAt: -1, _id: -1 }).session(session || null);
  if (latest && exceptionStillUsable(latest, strategy, amount)) return latest;
  if (latest) await dropLegacyExceptionIndex();
  const values = {
    request: request._id,
    dimensionKey: key,
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    budgetItem: line.budgetItem,
    project: line.project,
    strategy,
    availableAmount: available,
    requestedAmount: amount,
    budgetLimits: limits || undefined,
    requestedBy: userId,
    supersedes: latest?._id,
    history: [{ action: "CREATED", by: userId, comments: latest ? `${comments} Supersedes the ${latest.status} exception ${latest._id}.` : comments }]
  };
  try {
    const [created] = await BudgetException.create([values], session ? { session } : undefined);
    return created;
  } catch (error) {
    // A concurrent attempt opened the same PENDING exception first.
    if (error?.code !== 11000) throw error;
    const open = await BudgetException.findOne({ request: request._id, dimensionKey: key, status: "PENDING" }).session(session || null);
    if (!open) throw error;
    return open;
  }
}

// A PENDING exception becomes moot once the commitment succeeds within budget (or the request is
// voided and its budget released). Resolving it keeps it from blocking closure or inflating the
// "budget exceptions pending" counters, while preserving it as audited history.
export async function resolveMootBudgetExceptions(requestId, userId, reason, { session } = {}) {
  const pending = await BudgetException.find({ request: requestId, status: "PENDING" }).session(session || null);
  if (!pending.length) return 0;
  const at = new Date();
  await BudgetException.updateMany(
    { _id: { $in: pending.map((item) => item._id) }, status: "PENDING" },
    { $set: { status: "RESOLVED", resolvedAt: at, resolutionReason: reason }, $inc: { __v: 1 }, $push: { history: { action: "AUTO_RESOLVED", by: userId, at, comments: reason } } },
    { session }
  );
  for (const exception of pending) {
    await recordAudit({ entityType: "BudgetException", entity: exception, requestId, action: "AUTO_RESOLVED", user: userId ? { _id: userId } : undefined, module: "BUDGET", comments: reason, oldValues: { status: "PENDING" }, newValues: { status: "RESOLVED" }, session });
  }
  return pending.length;
}

// TRANSITIONAL (Phase 1) commitments are informational and must never block: a larger invoice
// (for example a USD invoice booked at a higher exchange rate) simply grows the informational
// commitment, without touching any pooled Cost Center or allocation balance.
function isInformationalCommitment(commitment) {
  return Boolean(commitment?.lines?.length) && commitment.lines.every((line) => line.mode !== "ACTIVE");
}

async function adjustInformationalCommitment(commitment, additionalAmount, userId, { session, exchangeRateEvidence, comments } = {}) {
  const amount = roundMoney(additionalAmount);
  if (!(amount > 0)) return commitment;
  const weight = sumMoney(commitment.lines.map((line) => line.amount));
  const previousTotal = roundMoney(commitment.totalAmount || 0);
  let assigned = 0;
  commitment.lines.forEach((line, index) => {
    const isLast = index === commitment.lines.length - 1;
    const share = isLast ? subtractMoney(amount, assigned) : weight > 0 ? Math.floor(amount * 100 * line.amount / weight) / 100 : 0;
    line.amount = addMoney(line.amount, share);
    assigned = addMoney(assigned, share);
  });
  commitment.totalAmount = addMoney(previousTotal, amount);
  commitment.adjustments.push({ reason: "INFORMATIONAL_TOP_UP", mode: "TRANSITIONAL", at: new Date(), by: userId, previousTotal, amount, exchangeRateEvidence });
  commitment.status = deriveCommitmentStatus(commitment);
  commitment.history.push({ status: commitment.status, amount, by: userId, comments: comments || "Informational (TRANSITIONAL) commitment adjusted to the invoiced amount; no funds are enforced." });
  await commitment.save({ session });
  return commitment;
}

async function releaseApplied(applied, session) {
  if (session) return; // The enclosing transaction aborts all its writes together.
  for (const item of [...applied].reverse()) {
    const inverse = Object.fromEntries(Object.entries(item.increments || { committedAmount: item.amount }).map(([key, value]) => [key, -value]));
    if (item.kind === "allocation") {
      await changeAllocationUsage({ allocation: item.id, budgetMonth: item.budgetMonth, increments: inverse, session });
    } else {
      await CostCenter.updateOne({ _id: item.id }, { $inc: inverse }, { session });
    }
  }
}

export async function reserveBudget(request, userId, { session, additionalAmount = 0, exchangeRateEvidence } = {}) {
  const existing = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (existing && existing.status !== BUDGET_STATUS.NO_BUDGET && !(additionalAmount > 0)) return existing;
  if (additionalAmount > 0 && existing && ![BUDGET_STATUS.RELEASED, BUDGET_STATUS.CLOSED, BUDGET_STATUS.DEFERRED].includes(existing.status) && isInformationalCommitment(existing)) {
    return adjustInformationalCommitment(existing, additionalAmount, userId, { session, exchangeRateEvidence, comments: "Informational (TRANSITIONAL) commitment increased for the invoice exchange-rate difference; no funds are enforced." });
  }
  if (additionalAmount > 0 && (!existing || [BUDGET_STATUS.RELEASED, BUDGET_STATUS.CLOSED, BUDGET_STATUS.NO_BUDGET, BUDGET_STATUS.DEFERRED].includes(existing.status))) throw new AppError(409, "This commitment cannot be increased for an exchange-rate variance.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
  if (existing?.status === BUDGET_STATUS.NO_BUDGET && (existing.executedAmount > 0 || existing.paidAmount > 0 || await AccountsPayable.exists({ request: request._id }).session(session || null))) {
    throw new AppError(409, "Historical unreserved budget already has financial postings; a controlled budget adjustment is required.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
  }

  const grouped = groupedRequestLines(request);
  if (additionalAmount > 0) {
    const weight = sumMoney(grouped.map(line => line.amount));
    if (!(weight > 0)) throw new AppError(422, "Budget dimensions are required for the exchange-rate difference.");
    let assigned = 0;
    grouped.forEach((line, index) => {
      line.amount = index === grouped.length - 1 ? subtractMoney(additionalAmount, assigned) : Math.floor(additionalAmount * 100 * line.amount / weight) / 100;
      assigned = addMoney(assigned, line.amount);
    });
  }
  const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
  const centerMap = new Map(centers.map((center) => [String(center._id), center]));
  const prepared = [];
  const demands = new Map();

  for (const line of grouped) {
    const center = centerMap.get(String(line.costCenter));
    if (!center?.active) {
      throw new AppError(422, "Every request line needs an active Cost Center before budget commitment.", { costCenter: line.costCenter }, ERROR_CODES.VALIDATION_ERROR);
    }
    const [rule, allocation] = await Promise.all([
      resolveRule(line, center, request.issueDate),
      findAllocation(request.accountingPeriod, line, session)
    ]);
    // Phase 1 (TRANSITIONAL) records this line's commitment informationally without enforcing
    // available funds; Phase 2 (ACTIVE) blocks below. A linked annual/monthly BudgetPlan always
    // means the dimension is actively managed, regardless of the Cost Center's own default mode.
    const mode = isBudgetPlan(allocation) ? "ACTIVE" : rule.mode || "TRANSITIONAL";
    const exceptionStrategy = ["EXTRAORDINARY_APPROVAL", "REJECT"].includes(rule.exceptionStrategy) ? rule.exceptionStrategy : "REQUEST_BUDGET_INCREASE";
    const limits = budgetLimits(allocation, request.accountingPeriod, line.amount);
    const sourceKey = String(allocation?._id || center._id);
    const demand = demands.get(sourceKey) || 0;
    const rawAvailable = limits?.available ?? (allocation
      ? subtractMoney(subtractMoney(allocation.assignedAmount, allocation.committedAmount), allocation.executedAmount)
      : subtractMoney(subtractMoney(center.annualBudget, center.committedAmount), center.executedAmount));
    const available = subtractMoney(rawAvailable, demand);
    demands.set(sourceKey, addMoney(demand, line.amount));
    let budgetException = null;
    let exceptionApproved = false;
    if (mode === "ACTIVE" && available < line.amount && exceptionStrategy === "REJECT") {
      // REJECT means exactly that: no BudgetException is prepared, there is no extraordinary
      // path to retry into. The caller (approvalService.commitApprovedRequestBudget) rejects
      // the request outright on this signal.
      throw new AppError(
        409,
        `Budget rejected: this dimension's rule rejects requests exceeding available funds (available PEN ${available.toFixed(2)}, required PEN ${line.amount.toFixed(2)}).`,
        { available, required: line.amount, exceptionStrategy, costCenter: center.code, hardReject: true, ...limits },
        ERROR_CODES.INSUFFICIENT_BUDGET
      );
    }
    if (mode === "ACTIVE" && available < line.amount) {
      const key = dimensionKey(line, request.project) + (additionalAmount > 0 ? `|FX:${addMoney(existing.totalAmount, additionalAmount)}` : "");
      budgetException = await findOrOpenBudgetException({
        request, key, line, strategy: exceptionStrategy, available, amount: line.amount, limits, userId,
        comments: "Insufficient budget detected before commitment."
      });
      exceptionApproved = exceptionStrategy === "EXTRAORDINARY_APPROVAL" && budgetException.strategy === "EXTRAORDINARY_APPROVAL" && budgetException.status === "APPROVED" && line.amount <= budgetException.requestedAmount;
      if (!exceptionApproved) {
        throw new AppError(
          409,
          `insufficient budget: budget exception ${exceptionStrategy} is required before this request can continue.`,
          { available, required: line.amount, exceptionStrategy, costCenter: center.code, budgetException: budgetException._id, exceptionStatus: budgetException.status, ...limits },
          ERROR_CODES.INSUFFICIENT_BUDGET
        );
      }
    }
    prepared.push({ ...line, mode, exceptionStrategy, allocation, budgetMonth: limits?.budgetMonth, center, budgetException, exceptionApproved });
  }

  const applied = [];
  try {
    for (const line of prepared.filter((item) => item.mode === "ACTIVE")) {
      if (line.allocation) {
        await changeAllocationUsage({ allocation: line.allocation._id, budgetMonth: line.budgetMonth, increments: { committedAmount: line.amount }, required: line.amount, allowOverrun: line.exceptionApproved, session });
        applied.push({ kind: "allocation", id: line.allocation._id, budgetMonth: line.budgetMonth, amount: line.amount });
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
    const values = {
      request: request._id,
      requestNumber: request.requestNumber,
      period: request.accountingPeriod,
      lines: prepared.map((line) => ({
        allocation: line.allocation?._id,
        budgetMonth: line.budgetMonth,
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
    };
    if (existing && additionalAmount > 0) {
      existing.adjustments.push({ reason: "EXCHANGE_RATE_VARIANCE", at: new Date(), by: userId, previousTotal: existing.totalAmount, previousLines: existing.lines.map(line => line.toObject()), addedLines: values.lines, amount: additionalAmount, exchangeRateEvidence });
      for (const added of values.lines) {
        const line = existing.lines.find(item => dimensionKey(item) === dimensionKey(added) && String(item.allocation || "") === String(added.allocation || "") && item.budgetMonth === added.budgetMonth);
        if (line) line.amount = addMoney(line.amount, added.amount);
        else existing.lines.push(added);
      }
      existing.totalAmount = addMoney(existing.totalAmount, additionalAmount);
      existing.status = deriveCommitmentStatus(existing);
      existing.history.push({ status: existing.status, amount: additionalAmount, by: userId, comments: "Additional budget reserved for the invoice exchange-rate difference within the approved source-currency amount." });
      await existing.save({ session });
      await resolveMootBudgetExceptions(request._id, userId, "The exchange-rate difference was reserved within available budget; the pending exception is no longer needed.", { session });
      return existing;
    }
    let commitment = existing;
    if (existing) {
      const history = [...existing.history, ...values.history];
      const snapshot = existing.toObject();
      Object.assign(existing, values, { createdBy: existing.createdBy, history, legacyUnreservedSnapshot: snapshot });
      await existing.save({ session });
    } else {
      [commitment] = await BudgetCommitment.create([values], session ? { session } : undefined);
    }
    await resolveMootBudgetExceptions(request._id, userId, "The budget commitment succeeded; the pending exception is no longer needed.", { session });
    return commitment;
  } catch (error) {
    await releaseApplied(applied, session);
    throw error;
  }
}

export async function assertBudgetBeforePosting(request, { session, amount, userId, allowFxTopUp = false, exchangeRateEvidence } = {}) {
  let commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  // NO_BUDGET is retried once in case a real allocation/rule now applies; if it still resolves to
  // NO_BUDGET, that is Phase 1 (TRANSITIONAL) working as designed — informational, not a blocker.
  // Once the informational commitment already has financial postings it is kept as recorded
  // (a retry would refuse to re-reserve it), so TRANSITIONAL mode can never block here.
  if (commitment?.status === BUDGET_STATUS.NO_BUDGET && userId && !(commitment.executedAmount > 0 || commitment.paidAmount > 0 || await AccountsPayable.exists({ request: request._id }).session(session || null))) {
    commitment = await reserveBudget(request, userId, { session });
  }
  if (!commitment || commitment.status === BUDGET_STATUS.RELEASED || (commitment.status === BUDGET_STATUS.DEFERRED && request.flowType !== "C")) {
    throw new AppError(409, "A valid budget commitment is required before accounting.", { request: request._id }, ERROR_CODES.INSUFFICIENT_BUDGET);
  }
  if (amount !== undefined && commitment.status !== BUDGET_STATUS.DEFERRED) {
    const remaining = subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "executedAmount"));
    if (roundMoney(amount) > remaining && isInformationalCommitment(commitment)) {
      return adjustInformationalCommitment(commitment, subtractMoney(amount, remaining), userId, { session, exchangeRateEvidence });
    }
    if (roundMoney(amount) > remaining) {
      if (allowFxTopUp && request.currency === "USD" && userId) return reserveBudget(request, userId, { session, additionalAmount: subtractMoney(amount, remaining), exchangeRateEvidence });
      throw new AppError(409, "Invoice exceeds the remaining budget commitment.", { remaining, required: amount }, ERROR_CODES.INSUFFICIENT_BUDGET);
    }
  }
  return commitment;
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

async function changeTrackedUsage(line, increments, session, applied) {
  if (line.allocation) {
    await changeAllocationUsage({ allocation: line.allocation, budgetMonth: line.budgetMonth, increments, session });
    applied.push({ kind: "allocation", id: line.allocation, budgetMonth: line.budgetMonth, increments });
  } else {
    await CostCenter.updateOne({ _id: line.costCenter }, { $inc: increments }, { session });
    applied.push({ kind: "costCenter", id: line.costCenter, increments });
  }
}

async function applyExecutionAllocations(commitment, allocations, session, applied) {
  for (const allocation of allocations) {
    const line = commitment.lines[allocation.index];
    line.executedAmount = addMoney(trackedLineAmount(line, "executedAmount"), allocation.amount);
    if (line.mode !== "ACTIVE") continue;
    await changeTrackedUsage(line, { committedAmount: -allocation.amount, executedAmount: allocation.amount }, session, applied);
  }
}

async function applyPaidAllocations(commitment, allocations, session, applied) {
  for (const allocation of allocations) {
    const line = commitment.lines[allocation.index];
    line.paidAmount = addMoney(trackedLineAmount(line, "paidAmount"), allocation.amount);
    if (line.mode !== "ACTIVE") continue;
    await changeTrackedUsage(line, { paidAmount: allocation.amount }, session, applied);
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
  const appliedUsage = [];
  try {
    await applyExecutionAllocations(commitment, allocations, session, appliedUsage);
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
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
}

export async function executeBudget(request, userId, { session, comments } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment) return commitment;
  const remaining = subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "executedAmount"));
  return executeBudgetAmount(request, userId, remaining, { session, comments });
}

// Mirror image of executeBudgetAmount: moves an amount back from executed into committed
// (the request may still need it for a corrected/replacement provision) rather than
// releasing it outright. If every AP under the request ends up cancelled, a subsequent
// releaseBudget/void correctly frees the now-fully-unexecuted committed amount.
export async function reverseBudgetExecution(request, userId, amount, { session, comments } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment) return commitment;
  const currentExecuted = currentTrackedAmount(commitment, "executedAmount");
  const requested = roundMoney(amount);
  const amountToReverse = Math.min(Math.max(0, requested), Math.max(0, currentExecuted));
  if (amountToReverse <= 0) return commitment;

  const allocations = allocateAcrossLines(commitment.lines, amountToReverse, (line) => trackedLineAmount(line, "executedAmount"));
  const appliedUsage = [];
  try {
    for (const allocation of allocations) {
      const line = commitment.lines[allocation.index];
      line.executedAmount = subtractMoney(trackedLineAmount(line, "executedAmount"), allocation.amount);
      if (line.mode === "ACTIVE") await changeTrackedUsage(line, { committedAmount: allocation.amount, executedAmount: -allocation.amount }, session, appliedUsage);
    }
    const applied = sumMoney(allocations.map((item) => item.amount));
    commitment.executedAmount = subtractMoney(currentExecuted, applied);
    commitment.status = deriveCommitmentStatus(commitment);
    commitment.history.push({
      status: commitment.status,
      amount: -applied,
      by: userId,
      comments: comments || "Budget execution reversed after an Accounts Payable cancellation."
    });
    await commitment.save({ session });
    return commitment;
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
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
  const appliedUsage = [];
  try {
    await applyPaidAllocations(commitment, allocations, session, appliedUsage);
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
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
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

  const appliedUsage = [];
  try {
    for (const line of commitment.lines.filter((item) => item.mode === "ACTIVE" && commitment.status !== BUDGET_STATUS.DEFERRED)) {
      const remainingCommitted = subtractMoney(line.amount, trackedLineAmount(line, "executedAmount"));
      if (remainingCommitted <= 0) continue;
      await changeTrackedUsage(line, { committedAmount: -remainingCommitted }, session, appliedUsage);
    }
    commitment.status = BUDGET_STATUS.RELEASED;
    commitment.releasedAt = new Date();
    commitment.releasedBy = userId;
    commitment.releaseReason = reason;
    commitment.history.push({ status: BUDGET_STATUS.RELEASED, amount: subtractMoney(commitment.totalAmount, currentTrackedAmount(commitment, "executedAmount")), by: userId, comments: reason });
    await commitment.save({ session });
    await resolveMootBudgetExceptions(request._id, userId, `Budget released: ${reason}`, { session });
    return commitment;
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
}

// Invoicing is complete (the request is closing): whatever part of the commitment was never
// executed by an invoice is released back to its Cost Center / budget plan, and the commitment's
// total is reduced to what was actually executed. A commitment that was never executed at all is
// released outright. Returns the released amount so the caller can audit it.
export async function releaseUnexecutedCommitment(request, userId, reason, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || [BUDGET_STATUS.CLOSED, BUDGET_STATUS.RELEASED, BUDGET_STATUS.DEFERRED].includes(commitment.status)) return { commitment, releasedAmount: 0 };
  const executed = currentTrackedAmount(commitment, "executedAmount");
  const releasable = subtractMoney(commitment.totalAmount, executed);
  if (releasable <= 0) return { commitment, releasedAmount: 0 };
  if (executed <= 0) return { commitment: await releaseBudget(request, userId, reason, { session }), releasedAmount: releasable };

  const appliedUsage = [];
  try {
    const previousLines = commitment.lines.map((line) => line.toObject ? line.toObject() : { ...line });
    for (const line of commitment.lines) {
      const lineExecuted = trackedLineAmount(line, "executedAmount");
      const remaining = subtractMoney(line.amount, lineExecuted);
      if (remaining <= 0) continue;
      if (line.mode === "ACTIVE") await changeTrackedUsage(line, { committedAmount: -remaining }, session, appliedUsage);
      line.amount = lineExecuted;
    }
    const previousTotal = roundMoney(commitment.totalAmount);
    commitment.totalAmount = executed;
    commitment.adjustments.push({ reason: "UNINVOICED_BALANCE_RELEASED", at: new Date(), by: userId, previousTotal, previousLines, amount: -releasable, comments: reason });
    commitment.status = deriveCommitmentStatus(commitment);
    commitment.releasedAt = new Date();
    commitment.releasedBy = userId;
    commitment.releaseReason = reason;
    commitment.history.push({ status: commitment.status, amount: releasable, by: userId, comments: `Uninvoiced commitment released: ${reason}` });
    await commitment.save({ session });
    return { commitment, releasedAmount: releasable };
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
}

// Historical compatibility only. New Track C advances use reserveBudget before posting;
// expense execution remains deferred until Finance validates the rendition.
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
    const [rule, allocation] = await Promise.all([resolveRule(line, center, request.issueDate), findAllocation(request.accountingPeriod, line, session)]);
    prepared.push({
      ...line,
      mode: isBudgetPlan(allocation) ? "ACTIVE" : rule.mode || "TRANSITIONAL",
      exceptionStrategy: rule.exceptionStrategy || "REJECT",
      allocation: allocation?._id,
      budgetMonth: budgetLimits(allocation, request.accountingPeriod)?.budgetMonth
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

export async function assertRenditionBudgetAvailable(request, userId, lines, { session } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || ![BUDGET_STATUS.COMMITTED, BUDGET_STATUS.DEFERRED, BUDGET_STATUS.CLOSED].includes(commitment.status)) throw new AppError(409, "A valid advance budget record is required before rendition posting.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
  if (commitment.status === BUDGET_STATUS.CLOSED) return;
  const preview = await previewBudget({ ...(request.toObject?.() || request), accountingPeriod: commitment.period, lines });
  const demands = new Map();
  for (const line of preview.lines) {
    const sourceId = String(line.allocation || line.costCenter);
    const requested = addMoney(demands.get(sourceId) || 0, line.amount);
    demands.set(sourceId, requested);
    const held = commitment.status === BUDGET_STATUS.COMMITTED
      ? sumMoney(commitment.lines.filter(item => item.mode === "ACTIVE" && String(item.allocation || item.costCenter) === sourceId).map(item => subtractMoney(item.amount, item.executedAmount || 0))) : 0;
    const available = subtractMoney(addMoney(line.available || 0, held), subtractMoney(requested, line.amount));
    if (line.status !== "PENDING_VALIDATION" && available >= line.amount) continue;
    const key = dimensionKey(line, request.project);
    const strategy = line.exceptionStrategy === "EXTRAORDINARY_APPROVAL" ? "EXTRAORDINARY_APPROVAL" : "REQUEST_BUDGET_INCREASE";
    const exception = await findOrOpenBudgetException({
      request, key, line, strategy, available, amount: line.amount, userId, session,
      comments: "Insufficient actual-expense budget detected before rendition posting."
    });
    if (line.status !== "PENDING_VALIDATION" && strategy === "EXTRAORDINARY_APPROVAL" && exception.strategy === strategy && exception.status === "APPROVED" && exception.requestedAmount >= line.amount) continue;
    throw new AppError(409, "Rendition exceeds available budget; resolve the budget exception before accounting.", { budgetException: exception._id, available, required: line.amount }, ERROR_CODES.INSUFFICIENT_BUDGET);
  }
}

export async function executeDeferredBudget(request, userId, { session, lines } = {}) {
  const commitment = await BudgetCommitment.findOne({ request: request._id }).session(session || null);
  if (!commitment || ![BUDGET_STATUS.DEFERRED, BUDGET_STATUS.COMMITTED].includes(commitment.status)) return commitment;

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
  const hadReservation = commitment.status === BUDGET_STATUS.COMMITTED;
  const prepared = [];
  const appliedUsage = [];

  try {
    if (hadReservation) {
      commitment.renditionReservationSnapshot = commitment.toObject();
      for (const line of commitment.lines.filter(item => item.mode === "ACTIVE")) await changeTrackedUsage(line, { committedAmount: -subtractMoney(line.amount, line.executedAmount || 0) }, session, appliedUsage);
      commitment.history.push({ status: BUDGET_STATUS.RELEASED, amount: Math.max(0, subtractMoney(commitment.totalAmount, sumMoney(grouped.map(line => line.amount)))), by: userId, comments: "Unused advance reservation released; eligible actual expenses replace the reservation at rendition." });
    }
    const centers = await CostCenter.find({ _id: { $in: grouped.map((line) => line.costCenter) } }).session(session || null);
    const centerMap = new Map(centers.map((center) => [String(center._id), center]));
    for (const source of grouped) {
      const center = centerMap.get(String(source.costCenter));
      if (!center?.active) throw new AppError(422, "Every rendition line needs an active Cost Center.", { costCenter: source.costCenter }, ERROR_CODES.VALIDATION_ERROR);
      const [rule, allocation] = await Promise.all([
        resolveRule(source, center, request.issueDate),
        findAllocation(commitment.period, source, session)
      ]);
      const line = {
        ...source,
        mode: "ACTIVE",
        exceptionStrategy: rule.exceptionStrategy || source.exceptionStrategy || "REJECT",
        allocation: allocation?._id || source.allocation,
        budgetMonth: budgetLimits(allocation, commitment.period)?.budgetMonth
      };
      prepared.push(line);
      if (line.mode !== "ACTIVE" || !(line.amount > 0)) continue;
      const exception = await BudgetException.findOne({ request: request._id, dimensionKey: dimensionKey(line, request.project), strategy: "EXTRAORDINARY_APPROVAL", status: "APPROVED", requestedAmount: { $gte: line.amount } }).session(session || null);
      const allowOverrun = rule.exceptionStrategy === "EXTRAORDINARY_APPROVAL" && Boolean(exception);
      if (line.allocation) {
        const increments = { executedAmount: line.amount, paidAmount: line.amount };
        await changeAllocationUsage({ allocation: line.allocation, budgetMonth: line.budgetMonth, increments, required: line.amount, allowOverrun, session });
        appliedUsage.push({ kind: "allocation", id: line.allocation, budgetMonth: line.budgetMonth, increments });
      } else {
        const updated = await CostCenter.findOneAndUpdate(
          { _id: line.costCenter, ...(allowOverrun ? {} : { $expr: { $gte: [{ $subtract: [{ $subtract: ["$annualBudget", { $ifNull: ["$committedAmount", 0] }] }, { $ifNull: ["$executedAmount", 0] }] }, line.amount] } }) },
          { $inc: { executedAmount: line.amount, paidAmount: line.amount } },
          { new: true, session }
        );
        if (!updated) throw new AppError(409, "Cost Center budget changed before rendition validation.", { costCenter: line.costCenter, amount: line.amount }, ERROR_CODES.INSUFFICIENT_BUDGET);
        appliedUsage.push({ kind: "costCenter", id: line.costCenter, increments: { executedAmount: line.amount, paidAmount: line.amount } });
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
    await resolveMootBudgetExceptions(request._id, userId, "The rendition expense was executed within budget; the pending exception is no longer needed.", { session });
    return commitment;
  } catch (error) {
    await releaseApplied(appliedUsage, session);
    throw error;
  }
}
