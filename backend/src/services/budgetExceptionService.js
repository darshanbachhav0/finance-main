import BudgetException from "../models/BudgetException.js";
import BudgetRule from "../models/BudgetRule.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { AppError } from "../utils/AppError.js";
import { ROLES } from "../utils/constants.js";
import { recordAudit } from "./auditService.js";

// Configurable, per-dimension authority: Budget/Admin always prepare an
// exception; who may APPROVE/REJECT it is resolved from the most specific
// active BudgetRule matching the exception's own Cost Center/expense
// type/project (same specificity ordering budgetService.resolveRule uses),
// with an optional amount-based escalation to a higher authority. A
// dimension with no configured rule keeps the original "Management decides"
// behavior exactly, so this is purely additive.
export async function resolveExceptionApproverRole(exception) {
  const rules = await BudgetRule.find({
    active: true,
    $and: [
      { $or: [{ costCenter: exception.costCenter }, { costCenter: null }, { costCenter: { $exists: false } }] },
      { $or: [{ expenseType: exception.expenseType }, { expenseType: null }, { expenseType: { $exists: false } }] },
      { $or: [{ project: exception.project || "" }, { project: "*" }, { project: "" }] }
    ]
  }).sort({ costCenter: -1, expenseType: -1, project: -1 }).limit(1);
  const rule = rules[0];
  if (rule?.exceptionEscalationApproverRole && rule.exceptionEscalationAmount !== undefined && Number(exception.requestedAmount) > Number(rule.exceptionEscalationAmount)) {
    return rule.exceptionEscalationApproverRole;
  }
  return rule?.exceptionApproverRole || ROLES.MANAGEMENT;
}

export function assertExceptionDecisionAllowed(exception, request, user, action, approverRole = ROLES.MANAGEMENT) {
  if (exception.status !== "PENDING") throw new AppError(409, "This exception has already been decided.");
  if (action === "REVIEWED") {
    if (!["Budget", "Admin"].includes(user.role)) throw new AppError(403, "Budget review permission is required.");
    return;
  }
  if (!["APPROVED", "REJECTED"].includes(action)) throw new AppError(422, "Invalid exception action.");
  if (user.role !== approverRole) throw new AppError(403, `Only ${approverRole} may authorize a budget exception of this size/dimension.`, { requiredRole: approverRole });
  const id = value => String(value?._id || value || "");
  if ([exception.requestedBy, exception.preparedBy, request?.requester, request?.solicitor, ...(exception.history || []).filter(event => ["CREATED", "REVIEWED"].includes(event.action)).map(event => event.by)].some(value => value && id(value) === id(user._id))) {
    throw new AppError(403, "You cannot decide your own request or an exception you prepared.");
  }
}

export async function recordBudgetExceptionDecision(id, action, comments, user, req) {
  if (!String(comments || "").trim()) throw new AppError(422, "Review/decision comments are required.");
  const exception = await BudgetException.findById(id);
  if (!exception) throw new AppError(404, "Budget exception not found.");
  const request = await FinancialRequest.findById(exception.request).select("requester solicitor");
  const approverRole = await resolveExceptionApproverRole(exception);
  assertExceptionDecisionAllowed(exception, request, user, action, approverRole);
  const at = new Date();
  const fields = action === "REVIEWED"
    ? { preparedBy: user._id, preparedAt: at, preparationComments: comments }
    : { status: action, reviewedBy: user._id, reviewedAt: at, comments };
  const updated = await BudgetException.findOneAndUpdate({ _id: id, status: "PENDING", __v: exception.__v }, {
    $set: fields, $inc: { __v: 1 }, $push: { history: { action, by: user._id, at, comments } }
  }, { new: true, runValidators: true });
  if (!updated) throw new AppError(409, "The exception changed. Refresh before deciding.");
  await recordAudit({ entityType: "BudgetException", entity: updated, requestId: updated.request, action, user, req, module: "BUDGET", comments, oldValues: { status: exception.status }, newValues: { status: updated.status, approverRole, ...fields } });
  return updated;
}
