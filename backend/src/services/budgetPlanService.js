import crypto from "node:crypto";
import mongoose from "mongoose";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import CostCenter from "../models/CostCenter.js";
import { recordAudit } from "./auditService.js";
import { budgetAvailable, budgetLimits, findBudgetAllocation, isBudgetPlan } from "./budgetAllocationService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { BUDGET_STATUS, ERROR_CODES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { BUDGET_PLANNING_MODES, budgetCents, distributeAnnualBudget, validBudgetPeriod, validBudgetYear } from "../../../shared/budgetPlanning.mjs";

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
  const plan = await BudgetAllocation.findById(id).populate("costCenter");
  if (!isBudgetPlan(plan)) throw new AppError(404, "Budget plan not found.", undefined, ERROR_CODES.NOT_FOUND);
  return serializeBudgetPlan(plan);
}

export async function createBudgetPlan(payload, user, req) {
  assertManager(user);
  if (!validBudgetYear(payload.year)) throw invalid("Enter a budget year between 2000 and 2199.");
  if (!Object.hasOwn(BUDGET_PLANNING_MODES, payload.planningMode)) throw invalid("Select a valid budget planning mode.");
  if (!mongoose.isValidObjectId(payload.costCenter)) throw invalid("Select a Cost Center.");
  if (payload.project !== undefined && (typeof payload.project !== "string" || payload.project.length > 150)) throw invalid("Enter a project of at most 150 characters.");
  const project = (payload.project || "").trim();
  const annual = amount(payload.assignedAmount);
  if (annual <= 0) throw invalid("The annual budget must be greater than zero.");
  const notes = reason(payload.reason);
  const center = await CostCenter.findById(payload.costCenter);
  if (!center?.active) throw invalid("Select an active Cost Center.");
  const dimension = { costCenter: center._id, project };
  const year = String(payload.year);
  const existing = await BudgetAllocation.findOne({ ...dimension, period: new RegExp(`^${year}(?:-|$)`) });
  if (existing) throw new AppError(409, "This Cost Center already has a budget for this year. Existing budgets remain unchanged; adjust it from Budget Control or choose another year.", { allocation: existing._id }, ERROR_CODES.CONFLICT);
  const historical = await BudgetCommitment.exists({ period: new RegExp(`^${year}-`), lines: { $elemMatch: { costCenter: center._id, project: project || { $in: ["", null] } } } });
  if (historical) throw new AppError(409, "This Cost Center already has budget activity in the selected year. Create a plan for a new year to preserve its recorded usage.", undefined, ERROR_CODES.CONFLICT);
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
  const plan = await BudgetAllocation.exists({ period: year, costCenter: candidate.costCenter, project: candidate.project || "", planningMode: { $in: Object.keys(BUDGET_PLANNING_MODES) } });
  if (plan) throw new AppError(409, "A linked annual budget already controls this dimension. Use Budget Control to adjust it.", undefined, ERROR_CODES.CONFLICT);
}

const positive = (value) => roundMoney(Math.max(0, Number(value) || 0));

// Management approved a REQUEST_BUDGET_INCREASE exception: add the missing money to the budget
// source the commitment will draw from, so the retried commitment fits. For an annual+monthly
// plan both the annual budget and the request's month grow by the same shortfall (keeping the
// monthly distribution within the annual total); an annual-only plan, a legacy allocation or an
// undated Cost Center budget grows its single annual figure. The plan adjustment carries a
// deterministic operationId, so repeating it never adds the money twice.
export async function applyBudgetExceptionIncrease(exception, request, user, req, { session } = {}) {
  const period = request?.accountingPeriod;
  if (!validBudgetPeriod(period)) throw invalid("The request needs a valid accounting month before its budget can be increased.");
  const line = { costCenter: exception.costCenter, project: exception.project || "" };
  const required = roundMoney(exception.requestedAmount || 0);
  const reasonText = `Budget increase approved by Management through the budget exception of request ${request.requestNumber || exception.request}.`;
  const base = { appliedAt: new Date(), appliedBy: user._id, costCenter: exception.costCenter };
  const allocation = await findBudgetAllocation(period, line, session);

  if (allocation) {
    const plan = isBudgetPlan(allocation);
    const limits = plan ? budgetLimits(allocation, period, required) : null;
    const shortfall = plan
      ? Math.max(positive(subtractMoney(required, limits.annualAvailable)), limits.monthlyAvailable === null ? 0 : positive(subtractMoney(required, limits.monthlyAvailable)))
      : positive(subtractMoney(required, budgetAvailable(allocation)));
    const monthly = plan && allocation.planningMode === "ANNUAL_MONTHLY";
    const result = { ...base, target: plan ? "BUDGET_PLAN" : "BUDGET_ALLOCATION", allocation: allocation._id, budgetMonth: limits?.budgetMonth, amount: shortfall };
    if (!(shortfall > 0)) return result;
    const operationId = `budget-exception-${exception._id}`;
    const entry = { operationId, action: "EXCEPTION_INCREASE", amount: shortfall, toMonth: monthly ? limits.budgetMonth : undefined, annualBefore: allocation.assignedAmount, annualAfter: addMoney(allocation.assignedAmount, shortfall), reason: reasonText, by: user._id, actorName: user.name, at: new Date() };
    const increments = { assignedAmount: shortfall, __v: 1 };
    if (monthly) increments[`months.${limits.budgetMonth - 1}.assignedAmount`] = shortfall;
    const updated = await BudgetAllocation.findOneAndUpdate({ _id: allocation._id, "adjustments.operationId": { $ne: operationId } }, { $inc: increments, $push: { adjustments: entry } }, { new: true, session });
    if (updated) await recordAudit({ entityType: "BudgetAllocation", entity: updated, requestId: exception.request, action: "EXCEPTION_INCREASE", module: "BUDGET", period: allocation.period, user, req, comments: reasonText, oldValues: { assignedAmount: allocation.assignedAmount }, newValues: entry, session });
    return result;
  }

  const center = await CostCenter.findById(exception.costCenter).session(session || null);
  if (!center) throw new AppError(404, "The exception's Cost Center was not found.", undefined, ERROR_CODES.NOT_FOUND);
  const shortfall = positive(subtractMoney(required, subtractMoney(subtractMoney(center.annualBudget || 0, center.committedAmount || 0), center.executedAmount || 0)));
  const result = { ...base, target: "COST_CENTER", amount: shortfall };
  if (!(shortfall > 0)) return result;
  const updated = await CostCenter.findOneAndUpdate({ _id: center._id }, { $inc: { annualBudget: shortfall } }, { new: true, session });
  await recordAudit({ entityType: "CostCenter", entity: updated, requestId: exception.request, action: "EXCEPTION_INCREASE", module: "BUDGET", user, req, comments: reasonText, oldValues: { annualBudget: center.annualBudget }, newValues: { annualBudget: updated.annualBudget, amount: shortfall, budgetException: exception._id }, session });
  return result;
}

const OPEN_COMMITMENT_STATUSES = [BUDGET_STATUS.COMMITTED, BUDGET_STATUS.PARTIALLY_EXECUTED, BUDGET_STATUS.EXECUTED, BUDGET_STATUS.PARTIALLY_PAID];
const CARRY_OVER_REASON = "YEAR_END_CARRY_OVER";
const dimensionOf = (allocation) => ({ costCenter: allocation.costCenter, project: allocation.project || "" });
const sameDimensionQuery = (allocation) => ({ costCenter: allocation.costCenter, project: allocation.project || { $in: ["", null] } });

// The next year's home for a carried commitment: an existing linked plan for the same
// dimension, otherwise an existing legacy allocation for that year, otherwise a new plan in the
// source plan's mode (or a new legacy annual allocation when the source was a legacy one).
async function carryOverTarget(source, toYear, user, session, created) {
  const dimension = sameDimensionQuery(source);
  const plan = await BudgetAllocation.findOne({ ...dimension, period: toYear, planningMode: { $in: Object.keys(BUDGET_PLANNING_MODES) } }).session(session || null);
  if (plan) return plan;
  const legacy = await BudgetAllocation.findOne({ ...dimension, period: toYear }).session(session || null)
    || await BudgetAllocation.findOne({ ...dimension, period: `${toYear}-01` }).session(session || null);
  if (legacy) return legacy;
  const planningMode = isBudgetPlan(source) ? source.planningMode : "LEGACY";
  const values = {
    ...dimensionOf(source), period: toYear, planningMode, assignedAmount: 0, active: true,
    ...(planningMode === "LEGACY" ? {} : {
      months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, assignedAmount: 0 })),
      adjustments: [{ operationId: crypto.randomUUID(), action: "CREATED", amount: 0, annualBefore: 0, annualAfter: 0, reason: `Created by the ${Number(toYear) - 1} year-end carry-over of open commitments.`, by: user._id, actorName: user.name }]
    })
  };
  const [allocation] = await BudgetAllocation.create([values], session ? { session } : undefined);
  created.push(allocation._id);
  return allocation;
}

function usageIncrements(allocation, budgetMonth, committed, assigned) {
  const increments = { committedAmount: committed, assignedAmount: assigned, __v: 1 };
  if (isBudgetPlan(allocation) && budgetMonth) {
    increments[`months.${budgetMonth - 1}.committedAmount`] = committed;
    if (allocation.planningMode === "ANNUAL_MONTHLY") increments[`months.${budgetMonth - 1}.assignedAmount`] = assigned;
  }
  return increments;
}

async function moveLine(commitment, line, remaining, toYear, user, session, created) {
  const source = await BudgetAllocation.findById(line.allocation).session(session || null);
  if (!source) return null;
  const target = await carryOverTarget(source, toYear, user, session, created);
  const targetMonth = isBudgetPlan(target) ? 1 : undefined;
  const operationKey = `carry-over-${commitment._id}-${line.allocation}-${line.budgetMonth || 0}`;
  // The funds travel with the commitment: the closing year gives up the committed amount and the
  // same assigned budget (its available balance is unchanged), the new year receives both, so the
  // carried commitment never consumes the new year's own budget.
  const bucketAssigned = source.planningMode === "ANNUAL_MONTHLY" && line.budgetMonth ? Number(source.months?.[line.budgetMonth - 1]?.assignedAmount || 0) : Number(source.assignedAmount || 0);
  const assignedOut = roundMoney(Math.min(remaining, bucketAssigned, Number(source.assignedAmount || 0)));
  const outEntry = { operationId: `${operationKey}-out`, action: "CARRY_OVER_OUT", amount: remaining, annualBefore: source.assignedAmount, annualAfter: subtractMoney(source.assignedAmount, assignedOut), reason: `Open commitment ${commitment.requestNumber} carried over to ${toYear}.`, by: user._id, actorName: user.name, at: new Date(), ...(line.budgetMonth ? { fromMonth: line.budgetMonth } : {}) };
  const inEntry = { operationId: `${operationKey}-in`, action: "CARRY_OVER_IN", amount: remaining, annualBefore: target.assignedAmount, annualAfter: addMoney(target.assignedAmount, remaining), reason: `Open commitment ${commitment.requestNumber} carried over from ${source.period.slice(0, 4)}.`, by: user._id, actorName: user.name, at: new Date(), ...(targetMonth ? { toMonth: targetMonth } : {}) };
  const out = await BudgetAllocation.findOneAndUpdate({ _id: source._id, "adjustments.operationId": { $ne: outEntry.operationId } }, { $inc: usageIncrements(source, line.budgetMonth, -remaining, -assignedOut), $push: { adjustments: outEntry } }, { new: true, session });
  const into = await BudgetAllocation.findOneAndUpdate({ _id: target._id, "adjustments.operationId": { $ne: inEntry.operationId } }, { $inc: usageIncrements(target, targetMonth, remaining, remaining), $push: { adjustments: inEntry } }, { new: true, session });
  return { source: out || source, target: into || target, targetMonth, assignedOut };
}

// Year-end carry-over (Budget or Admin, per fiscal year): every commitment of that year that is
// still open (committed but not yet executed by an invoice) moves, with its funds, into the next
// year's plan/allocation for the same dimension, in January. Executed/paid history stays in the
// closing year. The operation is idempotent: a commitment is carried at most once per year (its
// period moves to the new year and it records the carry-over), and each allocation movement
// carries a deterministic operationId.
export async function carryOverOpenCommitments({ year, user, req }) {
  assertManager(user);
  if (!validBudgetYear(year)) throw invalid("Enter a budget year between 2000 and 2199.");
  const fromYear = String(year);
  const toYear = String(Number(fromYear) + 1);
  if (!validBudgetYear(toYear)) throw invalid("The following budget year is outside the supported range.");
  const candidates = await BudgetCommitment.find({ period: new RegExp(`^${fromYear}-`), status: { $in: OPEN_COMMITMENT_STATUSES } }).select("_id");
  const summary = { fromYear, toYear, carriedCommitments: 0, carriedAmount: 0, alreadyCarried: 0, skippedLines: 0, createdAllocations: [], commitments: [] };
  for (const { _id } of candidates) {
    await runFinancialOperation(async (session) => {
      const commitment = await BudgetCommitment.findById(_id).session(session || null);
      if (!commitment || !commitment.period.startsWith(`${fromYear}-`) || !OPEN_COMMITMENT_STATUSES.includes(commitment.status)) return;
      if ((commitment.adjustments || []).some((entry) => entry?.reason === CARRY_OVER_REASON && entry.fromYear === fromYear)) { summary.alreadyCarried += 1; return; }
      const previousLines = commitment.lines.map((line) => line.toObject());
      const previousPeriod = commitment.period;
      const nextLines = [];
      let moved = 0;
      for (const line of commitment.lines) {
        const executed = roundMoney(line.executedAmount || 0);
        const remaining = subtractMoney(line.amount, executed);
        if (line.mode !== "ACTIVE" || remaining <= 0) { nextLines.push(line.toObject()); continue; }
        if (!line.allocation) { summary.skippedLines += 1; nextLines.push(line.toObject()); continue; }
        const result = await moveLine(commitment, line, remaining, toYear, user, session, summary.createdAllocations);
        if (!result) { summary.skippedLines += 1; nextLines.push(line.toObject()); continue; }
        const base = line.toObject();
        if (executed > 0) nextLines.push({ ...base, amount: executed });
        nextLines.push({ ...base, allocation: result.target._id, budgetMonth: result.targetMonth, amount: remaining, executedAmount: 0, paidAmount: 0 });
        moved = addMoney(moved, remaining);
      }
      if (!(moved > 0)) return;
      commitment.lines = nextLines;
      commitment.period = `${toYear}-01`;
      commitment.adjustments.push({ reason: CARRY_OVER_REASON, fromYear, toYear, previousPeriod, previousLines, amount: moved, at: new Date(), by: user._id });
      commitment.history.push({ status: commitment.status, amount: moved, by: user._id, comments: `Open commitment carried over from ${fromYear} to ${toYear}.` });
      await commitment.save({ session });
      await recordAudit({ entityType: "BudgetCommitment", entity: commitment, requestId: commitment.request, action: CARRY_OVER_REASON, module: "BUDGET", period: toYear, user, req, comments: `Open commitment carried over from ${fromYear} to ${toYear}.`, oldValues: { period: previousPeriod, lines: previousLines }, newValues: { period: commitment.period, amount: moved }, session });
      summary.carriedCommitments += 1;
      summary.carriedAmount = addMoney(summary.carriedAmount, moved);
      summary.commitments.push({ commitment: commitment._id, requestNumber: commitment.requestNumber, amount: moved });
    });
  }
  await recordAudit({ entityType: "BudgetYearEnd", entity: `carry-over-${fromYear}`, action: "YEAR_END_CARRY_OVER_RUN", module: "BUDGET", period: fromYear, user, req, comments: `Year-end carry-over ${fromYear} → ${toYear}.`, newValues: { ...summary, commitments: summary.commitments.length } });
  return summary;
}
