import crypto from "node:crypto";
import mongoose from "mongoose";
import AccountingPeriod from "../models/AccountingPeriod.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetPlanChange from "../models/BudgetPlanChange.js";
import CostCenter from "../models/CostCenter.js";
import { recordAudit } from "./auditService.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { notificationText, notifyRoles } from "./notificationService.js";
import { budgetAvailable, budgetLimits, findBudgetAllocation, isBudgetPlan } from "./budgetAllocationService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { BUDGET_STATUS, ERROR_CODES, FINANCE_CONFIGURATION_KEYS, ROLES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { BUDGET_MONTHS, BUDGET_PLANNING_MODES, budgetCents, distributeAnnualBudget, validBudgetPeriod, validBudgetYear } from "../../../shared/budgetPlanning.mjs";

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
  const [closedMonths, pendingChanges] = await Promise.all([
    closedPlanMonths(plan.period),
    BudgetPlanChange.find({ plan: plan._id, status: "PENDING" }).sort({ createdAt: 1 }).lean()
  ]);
  // closedMonths: months in a closed accounting period (Admin may still edit them).
  return { ...serializeBudgetPlan(plan), closedMonths, pendingChanges };
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

// ---------------------------------------------------------------------------------------------
// Plan changes (Admin only). Every change is validated against the plan as it is now, applied
// atomically with its history entry, and audited. A change that moves more money than the
// BUDGET_CHANGE_APPROVAL_THRESHOLD finance configuration waits for Management approval instead
// (BudgetPlanChange); approving it replays the same change after re-checking every rule.
// ---------------------------------------------------------------------------------------------
const PLAN_CHANGE_ACTIONS = ["TRANSFER", "ALLOCATE_RESERVE", "RELEASE_TO_RESERVE", "INCREASE", "DECREASE", "REDISTRIBUTE", "MODE_CHANGE", "SETTINGS"];
const MONTHLY_ONLY_ACTIONS = ["TRANSFER", "ALLOCATE_RESERVE", "RELEASE_TO_RESERVE", "REDISTRIBUTE", "SETTINGS"];
const monthName = (value) => BUDGET_MONTHS[value - 1];
const money = (value) => `PEN ${roundMoney(value).toFixed(2)}`;
// What a month has already consumed: its committed plus executed amounts. A month's budget can
// never be set below this, so approved requests and posted invoices stay covered.
const usedIn = (bucket) => addMoney(bucket?.committedAmount || 0, bucket?.executedAmount || 0);
const reserveOf = (plan) => subtractMoney(plan.assignedAmount, sumMoney((plan.months || []).map((bucket) => bucket.assignedAmount)));

function assertPlanEditor(user) {
  if (user?.role !== "Admin") throw new AppError(403, "Only Admin can change a budget plan.", undefined, ERROR_CODES.FORBIDDEN);
}

// Lima calendar month, so a "month end" matches the university's own calendar.
export function limaYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).formatToParts(now);
  return { year: Number(parts.find((part) => part.type === "year").value), month: Number(parts.find((part) => part.type === "month").value) };
}

// The last month of a plan year that has already ended (0 = none yet, 12 = the whole year).
export function lastEndedMonth(planYear, now = new Date()) {
  const { year, month: current } = limaYearMonth(now);
  if (Number(planYear) < year) return 12;
  if (Number(planYear) > year) return 0;
  return current - 1;
}

export async function closedPlanMonths(year, months) {
  const periods = (months || BUDGET_MONTHS.map((_, index) => index + 1)).map((value) => `${year}-${String(value).padStart(2, "0")}`);
  const closed = await AccountingPeriod.find({ period: { $in: periods }, status: "CLOSED" }).select("period").lean();
  return closed.map((item) => Number(item.period.slice(5, 7))).sort((left, right) => left - right);
}

// Reads the request into a plain, replayable description of the change.
export function normalizePlanChange(payload = {}) {
  const action = payload.action;
  if (!PLAN_CHANGE_ACTIONS.includes(action)) throw invalid("Select a valid budget adjustment.");
  const change = { action };
  if (["TRANSFER", "ALLOCATE_RESERVE", "RELEASE_TO_RESERVE", "INCREASE", "DECREASE"].includes(action)) {
    change.amount = amount(payload.amount);
    if (change.amount <= 0) throw invalid("The adjustment amount must be greater than zero.");
  }
  if (["TRANSFER", "RELEASE_TO_RESERVE"].includes(action)) change.fromMonth = month(payload.fromMonth);
  if (["TRANSFER", "ALLOCATE_RESERVE"].includes(action)) change.toMonth = month(payload.toMonth);
  if (action === "TRANSFER" && change.fromMonth === change.toMonth) throw invalid("Choose two different months.");
  if (action === "REDISTRIBUTE") {
    if (!Array.isArray(payload.months) || payload.months.length !== 12) throw invalid("Enter the budget of all twelve months.");
    change.months = payload.months.map(amount);
  }
  if (action === "MODE_CHANGE") {
    if (!Object.hasOwn(BUDGET_PLANNING_MODES, payload.planningMode)) throw invalid("Select a valid budget planning mode.");
    change.planningMode = payload.planningMode;
    if (change.planningMode === "ANNUAL_MONTHLY") {
      if (!["EQUAL", "USAGE"].includes(payload.distribution)) throw invalid("Choose how to split the annual budget across the months.");
      change.distribution = payload.distribution;
    }
  }
  if (action === "SETTINGS") {
    if (typeof payload.rollForward !== "boolean") throw invalid("Choose whether unused monthly budget rolls forward.");
    change.rollForward = payload.rollForward;
  }
  return change;
}

export function describePlanChange(change) {
  switch (change.action) {
    case "TRANSFER": return `Transfer ${money(change.amount)} from ${monthName(change.fromMonth)} to ${monthName(change.toMonth)}`;
    case "ALLOCATE_RESERVE": return `Allocate ${money(change.amount)} of the annual reserve to ${monthName(change.toMonth)}`;
    case "RELEASE_TO_RESERVE": return `Return ${money(change.amount)} of ${monthName(change.fromMonth)} to the annual reserve`;
    case "INCREASE": return `Increase the annual budget by ${money(change.amount)}`;
    case "DECREASE": return `Decrease the annual budget by ${money(change.amount)}`;
    case "REDISTRIBUTE": return "Edit the monthly distribution";
    case "MODE_CHANGE": return change.planningMode === "ANNUAL_MONTHLY" ? `Switch to annual + monthly control (${change.distribution === "EQUAL" ? "equal split" : "months keep their current usage"})` : "Switch to annual-only control";
    case "SETTINGS": return change.rollForward ? "Turn on automatic roll-forward of unused monthly budget" : "Turn off automatic roll-forward";
    default: return change.action;
  }
}

function assertMonthFloors(plan, assigned) {
  assigned.forEach((value, index) => {
    const floor = usedIn(plan.months[index]);
    if (value < floor) throw invalid(`${monthName(index + 1)} cannot go below what it has already committed and spent (${money(floor)}).`, { month: index + 1, floor });
  });
  const total = sumMoney(assigned);
  if (total > plan.assignedAmount) throw invalid(`The months add up to ${money(total)}, more than the annual budget of ${money(plan.assignedAmount)}.`, { distributed: total, annual: plan.assignedAmount });
}

// Validates a change against the plan as it is now and returns the MongoDB update and the
// history entry. `magnitude` is the money the change moves (compared with the approval threshold).
export function planChangeUpdate(plan, change, { now = new Date(), user } = {}) {
  const monthly = plan.planningMode === "ANNUAL_MONTHLY";
  if (MONTHLY_ONLY_ACTIONS.includes(change.action) && !monthly) throw invalid("This adjustment needs annual + monthly budget control.");
  const inc = {};
  const set = {};
  const entry = { action: change.action, annualBefore: plan.assignedAmount, annualAfter: plan.assignedAmount };
  let magnitude = change.amount || 0;
  let touched = [];
  const assignedOf = (value) => plan.months[value - 1].assignedAmount;
  const availableOf = (value) => budgetAvailable(plan.months[value - 1]);
  switch (change.action) {
    case "TRANSFER":
      if (availableOf(change.fromMonth) < change.amount) throw invalid(`${monthName(change.fromMonth)} has only ${money(Math.max(0, availableOf(change.fromMonth)))} unused.`);
      inc[`months.${change.fromMonth - 1}.assignedAmount`] = -change.amount;
      inc[`months.${change.toMonth - 1}.assignedAmount`] = change.amount;
      Object.assign(entry, { amount: change.amount, fromMonth: change.fromMonth, toMonth: change.toMonth });
      touched = [change.fromMonth, change.toMonth];
      break;
    case "ALLOCATE_RESERVE":
      if (reserveOf(plan) < change.amount) throw invalid(`The annual reserve has only ${money(reserveOf(plan))}.`);
      inc[`months.${change.toMonth - 1}.assignedAmount`] = change.amount;
      Object.assign(entry, { amount: change.amount, toMonth: change.toMonth });
      touched = [change.toMonth];
      break;
    case "RELEASE_TO_RESERVE":
      if (availableOf(change.fromMonth) < change.amount) throw invalid(`${monthName(change.fromMonth)} has only ${money(Math.max(0, availableOf(change.fromMonth)))} unused.`);
      inc[`months.${change.fromMonth - 1}.assignedAmount`] = -change.amount;
      Object.assign(entry, { amount: change.amount, fromMonth: change.fromMonth });
      touched = [change.fromMonth];
      break;
    case "INCREASE":
      entry.annualAfter = addMoney(plan.assignedAmount, change.amount);
      amount(entry.annualAfter);
      inc.assignedAmount = change.amount;
      entry.amount = change.amount;
      break;
    case "DECREASE": {
      // Monthly plans give up only undistributed money; annual-only plans only what is unused.
      const room = monthly ? reserveOf(plan) : budgetAvailable(plan);
      if (room < change.amount) throw invalid(monthly ? `Only the annual reserve (${money(room)}) can be removed. Return unused monthly budget to the reserve first.` : `Only ${money(Math.max(0, room))} of the annual budget is unused.`);
      entry.annualAfter = subtractMoney(plan.assignedAmount, change.amount);
      inc.assignedAmount = -change.amount;
      entry.amount = change.amount;
      break;
    }
    case "REDISTRIBUTE": {
      assertMonthFloors(plan, change.months);
      const changes = change.months.map((after, index) => ({ month: index + 1, before: assignedOf(index + 1), after })).filter((item) => roundMoney(item.before) !== roundMoney(item.after));
      if (!changes.length) throw invalid("No month changed.");
      for (const item of changes) set[`months.${item.month - 1}.assignedAmount`] = item.after;
      const raised = sumMoney(changes.filter((item) => item.after > item.before).map((item) => subtractMoney(item.after, item.before)));
      const lowered = sumMoney(changes.filter((item) => item.after < item.before).map((item) => subtractMoney(item.before, item.after)));
      magnitude = Math.max(raised, lowered);
      Object.assign(entry, { amount: magnitude, monthChanges: changes });
      touched = changes.map((item) => item.month);
      break;
    }
    case "MODE_CHANGE": {
      if (change.planningMode === plan.planningMode) throw invalid("The plan already uses this planning mode.");
      let assigned;
      if (change.planningMode === "ANNUAL_ONLY") {
        assigned = plan.months.map(() => 0);
        set["rollForward.enabled"] = false;
      } else {
        assigned = change.distribution === "EQUAL" ? distributeAnnualBudget(plan.assignedAmount) : plan.months.map(usedIn);
        try { assertMonthFloors(plan, assigned); } catch (error) {
          throw change.distribution === "EQUAL" ? invalid(`${error.message} Choose "keep current usage" instead, then move money between months.`) : error;
        }
      }
      set.planningMode = change.planningMode;
      assigned.forEach((value, index) => { set[`months.${index}.assignedAmount`] = value; });
      const changes = assigned.map((after, index) => ({ month: index + 1, before: assignedOf(index + 1), after })).filter((item) => roundMoney(item.before) !== roundMoney(item.after));
      Object.assign(entry, { modeBefore: plan.planningMode, modeAfter: change.planningMode, monthChanges: changes.length ? changes : undefined });
      magnitude = 0;
      break;
    }
    case "SETTINGS":
      if (Boolean(plan.rollForward?.enabled) === change.rollForward) throw invalid(change.rollForward ? "Roll-forward is already on." : "Roll-forward is already off.");
      set["rollForward.enabled"] = change.rollForward;
      if (change.rollForward) {
        // Only month ends after this moment roll; months already closed keep their balances.
        Object.assign(set, { "rollForward.enabledBy": user?._id, "rollForward.enabledAt": now, "rollForward.lastRolledMonth": Math.min(lastEndedMonth(plan.period, now), 11) });
      }
      entry.rollForwardEnabled = change.rollForward;
      magnitude = 0;
      break;
    default:
      throw invalid("Select a valid budget adjustment.");
  }
  return { inc, set, entry, magnitude, touched };
}

// Applies a validated change atomically (amounts and history together). `revision` guards against
// a plan that changed since the editor loaded it; an approval replays without one.
export async function applyPlanChange(planId, change, { actor, operationId: key, reasonText, revision, approval, req }) {
  const plan = await BudgetAllocation.findById(planId);
  if (!isBudgetPlan(plan) || !plan.active) throw new AppError(404, "Budget plan not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (plan.adjustments.some((entry) => entry.operationId === key)) return plan;
  if (revision !== undefined && revision !== plan.__v) throw new AppError(409, "The budget changed. Refresh it before making an adjustment.", undefined, ERROR_CODES.CONFLICT);
  const { inc, set, entry, touched } = planChangeUpdate(plan, change, { user: actor });
  const closedMonths = touched.length ? await closedPlanMonths(plan.period, touched) : [];
  const history = {
    ...entry, operationId: key, reason: reasonText, by: actor._id, actorName: actor.name, at: new Date(),
    closedMonths: closedMonths.length ? closedMonths : undefined,
    changeRequest: approval?.change?._id, approvedBy: approval?.user?._id, approvedByName: approval?.user?.name
  };
  const update = { $inc: { ...inc, __v: 1 }, $push: { adjustments: history } };
  if (Object.keys(set).length) update.$set = set;
  const updated = await BudgetAllocation.findOneAndUpdate({ _id: plan._id, __v: plan.__v, "adjustments.operationId": { $ne: key } }, update, { new: true });
  if (!updated) {
    const current = await BudgetAllocation.findById(plan._id);
    if (current?.adjustments?.some((item) => item.operationId === key)) return current;
    throw new AppError(409, "The budget changed. Refresh it before making an adjustment.", undefined, ERROR_CODES.CONFLICT);
  }
  await recordAudit({ entityType: "BudgetAllocation", entity: updated, action: change.action, module: "BUDGET", period: plan.period, user: approval?.user || actor, req, comments: reasonText, oldValues: { assignedAmount: plan.assignedAmount, planningMode: plan.planningMode }, newValues: history });
  return updated;
}

export async function adjustBudgetPlan(id, payload, user, req) {
  assertPlanEditor(user);
  if (!mongoose.isValidObjectId(id)) throw invalid("Select a valid budget plan.");
  const plan = await BudgetAllocation.findById(id).populate("costCenter", "code name");
  if (!isBudgetPlan(plan) || !plan.active) throw new AppError(404, "Budget plan not found.", undefined, ERROR_CODES.NOT_FOUND);
  const key = operationId(payload.operationId);
  // Retries of an applied or already submitted change return the current plan.
  if (plan.adjustments.some((entry) => entry.operationId === key) || await BudgetPlanChange.exists({ operationId: key })) return getBudgetPlan(id);
  if (!Number.isInteger(payload.revision) || payload.revision !== plan.__v) throw new AppError(409, "The budget changed. Refresh it before making an adjustment.", undefined, ERROR_CODES.CONFLICT);
  const notes = reason(payload.reason);
  const change = normalizePlanChange(payload);
  const { magnitude } = planChangeUpdate(plan, change, { user });
  const threshold = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.BUDGET_CHANGE_APPROVAL_THRESHOLD);
  const limit = Number(threshold?.numericValue || 0);
  if (limit > 0 && magnitude > limit) {
    const summary = describePlanChange(change);
    const pending = await BudgetPlanChange.create({ plan: plan._id, operationId: key, action: change.action, payload: change, amount: magnitude, threshold: limit, summary, reason: notes, requestedBy: user._id, requestedByName: user.name });
    await recordAudit({ entityType: "BudgetPlanChange", entity: pending, action: "BUDGET_CHANGE_REQUESTED", module: "BUDGET", period: plan.period, user, req, comments: notes, newValues: { plan: plan._id, summary, amount: magnitude, threshold: limit } });
    await notifyRoles({
      roles: [ROLES.MANAGEMENT],
      eventKey: `budget-plan-change:${pending._id}`,
      type: "BUDGET_PLAN_CHANGE",
      title: notificationText("Budget change awaiting approval"),
      message: notificationText("{costCenter} {year}: {summary} ({amount}). Requested by {name}.", { costCenter: plan.costCenter?.code, year: plan.period, summary, amount: money(magnitude), name: user.name }),
      path: `/budget?tab=changes&record=${pending._id}`,
      entityType: "BudgetPlanChange",
      entityId: pending._id
    });
    return { ...(await getBudgetPlan(id)), submittedForApproval: pending.toObject() };
  }
  await applyPlanChange(plan._id, change, { actor: user, operationId: key, reasonText: notes, revision: payload.revision, req });
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
