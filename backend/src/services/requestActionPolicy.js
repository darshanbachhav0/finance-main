import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { activeApprovalStep } from "./approvalRuleService.js";
import { canTransition } from "./workflowService.js";
import { canApproveStage, canModifyRequest, hasPermission, isActiveChainApprover } from "../utils/permissions.js";
import { APPROVAL_ROUTING_MODE, PERMISSIONS, REQUEST_STATUS, ROLES } from "../utils/constants.js";

export const REQUEST_ACTION = Object.freeze({
  EDIT: "EDIT",
  SUBMIT: "SUBMIT",
  DELETE: "DELETE",
  APPROVE: "APPROVE",
  OBSERVE: "OBSERVE",
  RETURN: "RETURN",
  REJECT: "REJECT",
  CANCEL: "CANCEL",
  CLOSE: "CLOSE",
  COMMIT_BUDGET: "COMMIT_BUDGET",
  ISSUE_ORDER: "ISSUE_ORDER",
  REGISTER_INVOICE: "REGISTER_INVOICE"
});

const approvalStatuses = new Set([
  REQUEST_STATUS.PENDING_APPROVAL,
  REQUEST_STATUS.DIRECTOR_APPROVED,
  REQUEST_STATUS.VICE_RECTOR_APPROVED
]);

const invoiceStatuses = new Set([
  REQUEST_STATUS.BUDGET_COMMITTED,
  REQUEST_STATUS.ACCOUNTED,
  REQUEST_STATUS.SCHEDULED,
  REQUEST_STATUS.BANK_FILE_GENERATED,
  REQUEST_STATUS.PAID,
  REQUEST_STATUS.RECONCILED,
  REQUEST_STATUS.OBSERVED_SUNAT,
  REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED,
  REQUEST_STATUS.PAYMENT_BOUNCED
]);

const idOf = value => String(value?._id || value || "");

function ownsRequest(request, user) {
  return idOf(request.requester || request.solicitor) === idOf(user);
}

function approvalActionsAllowed(request, user) {
  if (!approvalStatuses.has(canonicalRequestStatus(request.status))) return false;
  if (ownsRequest(request, user)) return false;
  const step = activeApprovalStep(request);
  if (step?.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN) {
    return user.role === ROLES.ADMIN || isActiveChainApprover(request, user);
  }
  if (!hasPermission(user, PERMISSIONS.REQUEST_APPROVE)) return false;
  if (!canApproveStage(request, user)) return false;
  if (step?.role && user.role !== ROLES.ADMIN && step.role !== user.role) return false;
  if ((step?.approvalLevel || request.approvalStage) === "AREA_DIRECTOR" && user.role !== ROLES.ADMIN) {
    const area = request.requesterArea || request.requestingArea;
    const areas = new Set([user.area, ...(user.approvalAreas || [])].filter(Boolean));
    if (area && !areas.has(area) && !areas.has("*")) return false;
  }
  return true;
}

export function allowedRequestActions(request, user, context = {}) {
  if (!request || !user || user.active === false || isTerminalRequest(request.status)) return [];
  const actions = new Set();
  const status = canonicalRequestStatus(request.status);
  const owner = ownsRequest(request, user);

  if (canModifyRequest(request, user)) {
    actions.add(REQUEST_ACTION.EDIT);
    actions.add(REQUEST_ACTION.SUBMIT);
    if (status === REQUEST_STATUS.DRAFT) actions.add(REQUEST_ACTION.DELETE);
  }

  if (approvalActionsAllowed(request, user)) {
    for (const action of [REQUEST_ACTION.APPROVE, REQUEST_ACTION.OBSERVE, REQUEST_ACTION.RETURN, REQUEST_ACTION.REJECT]) actions.add(action);
  }

  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)
      && context.hasActiveObligations === false
      && canTransition(status, REQUEST_STATUS.VOIDED)) actions.add(REQUEST_ACTION.CANCEL);

  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role) && context.closureReady === true) actions.add(REQUEST_ACTION.CLOSE);
  if ([ROLES.ADMIN, ROLES.BUDGET].includes(user.role) && status === REQUEST_STATUS.VICE_RECTOR_APPROVED) actions.add(REQUEST_ACTION.COMMIT_BUDGET);
  if ([ROLES.ADMIN, ROLES.BUDGET].includes(user.role) && context.procurementReady === true) actions.add(REQUEST_ACTION.ISSUE_ORDER);
  if (request.flowType === "A1" && request.purchaseOrder && invoiceStatuses.has(status)
      && ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role) || (user.role === ROLES.SOLICITOR && owner))) actions.add(REQUEST_ACTION.REGISTER_INVOICE);

  return [...actions];
}
