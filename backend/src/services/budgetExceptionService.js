import BudgetException from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { recordAudit } from "./auditService.js";
import { applyBudgetExceptionIncrease } from "./budgetPlanService.js";
import { notificationText, notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { runFinancialOperation } from "./transactionService.js";

// Configurable, per-dimension authority: Budget/Admin always prepare an
// exception; who may APPROVE/REJECT it is resolved from the most specific
// active BudgetRule matching the exception's own Cost Center/expense
// type/project (same specificity ordering budgetService.resolveRule uses),
// with an optional amount-based escalation to a higher authority. A
// dimension with no configured rule keeps the original "Management decides"
// behavior exactly, so this is purely additive.
// Only Management/Rectorate authority may ever decide a budget exception - the schema enum
// already enforces this on new/edited BudgetRule documents, but this guards against any rule
// persisted before that constraint existed, so a corrupted value can never make an exception
// undecidable (or worse, resolvable by an unintended role). Admin can repair the underlying
// BudgetRule via the audited master-data endpoint; Admin never becomes the approver itself.
const ALLOWED_EXCEPTION_APPROVER_ROLES = [ROLES.MANAGEMENT];
function safeApproverRole(role) {
  return ALLOWED_EXCEPTION_APPROVER_ROLES.includes(role) ? role : ROLES.MANAGEMENT;
}

export const budgetExceptionPath = (exception) => `/budget?tab=exceptions&record=${exception?._id || exception}`;

export async function resolveExceptionApproverRole(exception) {
  const rules = await BudgetRule.find({
    active: true,
    $and: [
      { $or: [{ costCenter: exception.costCenter }, { costCenter: null }, { costCenter: { $exists: false } }] },
      { $or: [{ project: exception.project || "" }, { project: "*" }, { project: "" }] }
    ]
  }).sort({ costCenter: -1, project: -1 }).limit(1);
  const rule = rules[0];
  if (rule?.exceptionEscalationApproverRole && rule.exceptionEscalationAmount !== undefined && Number(exception.requestedAmount) > Number(rule.exceptionEscalationAmount)) {
    return safeApproverRole(rule.exceptionEscalationApproverRole);
  }
  return safeApproverRole(rule?.exceptionApproverRole || ROLES.MANAGEMENT);
}

// Budget reviews first, Management decides second. An exception without a Budget review
// (preparedAt / a REVIEWED history event) cannot be approved or rejected yet.
export function exceptionReviewed(exception) {
  return Boolean(exception.preparedAt || (exception.history || []).some((event) => event.action === "REVIEWED"));
}

export function assertExceptionDecisionAllowed(exception, request, user, action, approverRole = ROLES.MANAGEMENT) {
  if (exception.status !== "PENDING") throw new AppError(409, "This exception has already been decided.");
  if ([REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED].includes(request?.status)) {
    throw new AppError(409, "The request of this exception is already closed, voided or rejected; there is nothing left to decide.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (action === "REVIEWED") {
    if (!["Budget", "Admin"].includes(user.role)) throw new AppError(403, "Budget review permission is required.");
    return;
  }
  if (!["APPROVED", "REJECTED"].includes(action)) throw new AppError(422, "Invalid exception action.");
  if (user.role !== approverRole) throw new AppError(403, `Only ${approverRole} may authorize a budget exception of this size/dimension.`, { requiredRole: approverRole });
  if (!exceptionReviewed(exception)) {
    throw new AppError(409, "Budget must review this exception before Management can decide it.", { budgetException: exception._id }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const id = value => String(value?._id || value || "");
  if ([exception.requestedBy, exception.preparedBy, request?.requester, request?.solicitor, ...(exception.history || []).filter(event => ["CREATED", "REVIEWED"].includes(event.action)).map(event => event.by)].some(value => value && id(value) === id(user._id))) {
    throw new AppError(403, "You cannot decide your own request or an exception you prepared.");
  }
}

async function notifyAfterDecision(exception, request, action) {
  const label = request?.requestNumber || String(exception.request);
  if (action === "REVIEWED") {
    await notifyRoles({
      roles: [ROLES.MANAGEMENT],
      eventKey: `budget-exception:${exception._id}:decision`,
      type: "BUDGET_EXCEPTION",
      title: notificationText("Budget exception ready for decision"),
      message: notificationText("{requestNumber}: Budget reviewed the exception; Management must approve or reject it.", { requestNumber: label }),
      path: budgetExceptionPath(exception),
      entityType: "BudgetException",
      entityId: exception._id
    });
    return;
  }
  await resolveNotification(`budget-exception:${exception._id}:decision`);
  await notifyRoles({
    roles: [ROLES.BUDGET, ROLES.ADMIN],
    eventKey: `budget-exception:${exception._id}:${action.toLowerCase()}`,
    type: "BUDGET_EXCEPTION",
    title: action === "APPROVED" ? notificationText("Budget exception approved") : notificationText("Budget exception rejected"),
    message: action !== "APPROVED"
      ? notificationText("{requestNumber}: Management rejected the exception. The request stays observed until it is corrected and resubmitted.", { requestNumber: label })
      : exception.appliedIncrease?.amount
        ? notificationText("{requestNumber}: Management approved the exception and the budget was increased by PEN {amount}. The budget commitment can proceed.", { requestNumber: label, amount: Number(exception.appliedIncrease.amount).toFixed(2) })
        : notificationText("{requestNumber}: Management approved the exception. The budget commitment can proceed.", { requestNumber: label }),
    path: budgetExceptionPath(exception),
    entityType: "BudgetException",
    entityId: exception._id
  });
}

export async function recordBudgetExceptionDecision(id, action, comments, user, req) {
  if (!String(comments || "").trim()) throw new AppError(422, "Review/decision comments are required.");
  const exception = await BudgetException.findById(id);
  if (!exception) throw new AppError(404, "Budget exception not found.");
  const request = await FinancialRequest.findById(exception.request).select("requester solicitor requestNumber accountingPeriod status observation");
  const approverRole = await resolveExceptionApproverRole(exception);
  assertExceptionDecisionAllowed(exception, request, user, action, approverRole);
  const at = new Date();
  const fields = action === "REVIEWED"
    ? { preparedBy: user._id, preparedAt: at, preparationComments: comments }
    : { status: action, reviewedBy: user._id, reviewedAt: at, comments };
  const updated = await runFinancialOperation(async (session) => {
    const decided = await BudgetException.findOneAndUpdate({ _id: id, status: "PENDING", __v: exception.__v }, {
      $set: fields, $inc: { __v: 1 }, $push: { history: { action, by: user._id, at, comments } }
    }, { new: true, runValidators: true, session });
    if (!decided) throw new AppError(409, "The exception changed. Refresh before deciding.");
    // Approving a "request budget increase" exception adds the missing money to the budget
    // automatically, so the commitment can proceed without a separate manual adjustment.
    if (action === "APPROVED" && decided.strategy === "REQUEST_BUDGET_INCREASE" && !decided.appliedIncrease?.appliedAt) {
      const increase = await applyBudgetExceptionIncrease(decided, request, user, req, { session });
      decided.appliedIncrease = increase;
      await decided.save({ session });
    }
    await recordAudit({ entityType: "BudgetException", entity: decided, requestId: decided.request, action, user, req, module: "BUDGET", comments, oldValues: { status: exception.status }, newValues: { status: decided.status, approverRole, ...fields, appliedIncrease: decided.appliedIncrease?.amount !== undefined ? decided.appliedIncrease : undefined }, session });
    return decided;
  });
  if (action === "REJECTED" && request?.status === REQUEST_STATUS.OBSERVED_BUDGET) {
    await FinancialRequest.updateOne({ _id: request._id, status: REQUEST_STATUS.OBSERVED_BUDGET }, {
      $set: { "observation.resolver": "REQUESTER", "observation.detail": `Management rejected the budget exception: ${comments}` }
    });
    await notifyUser({
      userId: request.requester || request.solicitor,
      eventKey: `request:${request._id}:budget-exception-rejected:${updated._id}`,
      type: "REQUEST_OBSERVED",
      title: notificationText("Budget exception rejected"),
      message: notificationText("{requestNumber}: Management rejected the budget exception. Adjust the request (for example the amount) and submit it for approval again.", { requestNumber: request.requestNumber }),
      path: `/requests/${request._id}/edit`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  }
  await notifyAfterDecision(updated, request, action);
  return updated;
}

// Budget-exception work that is still open: PENDING exceptions whose request is not terminal.
// awaitingDecision=true counts only reviewed exceptions (Management's queue), false only the
// ones Budget still has to review.
export async function countPendingBudgetExceptions({ awaitingDecision } = {}) {
  const query = { status: "PENDING", ...(awaitingDecision === true ? { preparedAt: { $ne: null } } : awaitingDecision === false ? { preparedAt: null } : {}) };
  const pending = await BudgetException.find(query).select("request").lean();
  if (!pending.length) return 0;
  const terminal = new Set((await FinancialRequest.find({ _id: { $in: pending.map((item) => item.request) }, status: { $in: [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED] } }).select("_id").lean()).map((item) => String(item._id)));
  return pending.filter((item) => !terminal.has(String(item.request))).length;
}
