import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { activeApprovalStep } from "./approvalRuleService.js";
import { recordAudit } from "./auditService.js";
import { notificationText, notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../utils/constants.js";

// An approved advance (Track C, entrega a rendir) is paid into the employee's verified bank
// account. When there is none yet, budget commitment stays intact, the request waits for
// Accounting provision, and the employee is told what to do. Bank verification
// resolves only the hold; it does not create a payable or execute a payment.
export const ADVANCE_BANK_HOLD = ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED;
const APPROVED_STATUSES = [REQUEST_STATUS.APPROVED, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.BUDGET_COMMITTED];

const requesterOf = (request) => request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
export const waitsForBankAccount = (request) => request?.observation?.code === ADVANCE_BANK_HOLD && !request.observation.resolvedAt;
export const bankNoticeKeys = (request) => [`request:${request._id}:advance-bank-needed`, `request:${request._id}:advance-bank-review`];

export async function holdAdvanceForBankAccount({ request, user, req, error }) {
  const ownerId = requesterOf(request);
  // An account already registered and waiting for review is Accounting's to verify; otherwise
  // the employee registers one (or marks one of several verified accounts as preferred).
  const pending = await EmployeeReimbursementBankAccount.findOne({ user: ownerId, active: true, currency: request.currency, verificationStatus: "PENDING" }).select("_id");
  const firstHold = !waitsForBankAccount(request);
  request.observation = {
    code: ADVANCE_BANK_HOLD,
    detail: error?.message || "Track C requires a verified employee bank account before the advance can be released.",
    resolver: pending ? "ACCOUNTING" : "REQUESTER",
    observedAt: new Date(),
    observedBy: user?._id
  };
  await request.save();
  if (firstHold) {
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "ADVANCE_WAITING_FOR_BANK_ACCOUNT", user, req, module: "TREASURY", message: request.observation.detail, newValues: { waitingFor: pending ? "ACCOUNTING_VERIFICATION" : "EMPLOYEE_BANK_ACCOUNT" } });
  }
  const params = { requestNumber: request.requestNumber, currency: request.currency };
  await notifyUser({
    userId: ownerId,
    eventKey: bankNoticeKeys(request)[0],
    type: "BANK_ACCOUNT_NEEDED",
    title: notificationText("Register your bank account to receive the advance"),
    message: pending
      ? notificationText("{requestNumber} is approved. Your bank account is waiting for Accounting's verification; the advance is paid once it is verified.", params)
      : notificationText("{requestNumber} is approved. Register your bank account in {currency} under My bank account; the advance is paid once Accounting verifies it.", params),
    path: "/reimbursement-bank",
    entityType: "FinancialRequest",
    entityId: request._id
  });
  if (pending) {
    await notifyRoles({
      roles: [ROLES.ACCOUNTING],
      eventKey: bankNoticeKeys(request)[1],
      type: "EMPLOYEE_BANK_REVIEW",
      title: notificationText("Verify a bank account to release an advance"),
      message: notificationText("{requestNumber}: the advance is approved and waits for the employee's bank account to be verified.", params),
      path: `/reimbursement-bank?record=${pending._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  }
  return request;
}

// Runs when an employee's bank account becomes usable (verified, or chosen as preferred): every
// approved advance of theirs in that currency still waiting has its bank hold cleared
// and goes to Accounting for an explicit provision. Never create CXP in this callback.
export async function releaseAdvancesWaitingForBank({ userId, currency, user, req }) {
  const { commitApprovedRequestBudget, resolveBudgetCommitmentFailure } = await import("./approvalService.js");
  const candidates = await FinancialRequest.find({
    $or: [{ requester: userId }, { solicitor: userId }],
    flowType: FLOW_TYPE.C,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    status: { $in: APPROVED_STATUSES },
    currency
  }).select("_id");
  const released = [];
  for (const { _id } of candidates) {
    const request = await FinancialRequest.findById(_id).select("+attachments.path");
    if (!request || activeApprovalStep(request)) continue;
    try {
      if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) {
        await commitApprovedRequestBudget({ request, user, req, automatic: true });
      }
      if (request.status === REQUEST_STATUS.BUDGET_COMMITTED) {
        if (waitsForBankAccount(request)) {
          request.observation.resolvedAt = new Date();
          request.observation.resolvedBy = user?._id;
          await request.save();
        }
        await resolveBankNotices(request);
        await notifyRoles({
          roles: [ROLES.ACCOUNTING],
          eventKey: `request:${request._id}:accounting`,
          type: "ACCOUNTING_PENDING",
          title: notificationText("Advance bank account verified — provision in Accounting"),
          message: notificationText("{requestNumber} has a verified employee account and an approved budget commitment. Accounting must provision it before Treasury can pay.", { requestNumber: request.requestNumber }),
          path: `/accounting?request=${request._id}`,
          entityType: "FinancialRequest", entityId: request._id
        });
        released.push(request.requestNumber);
      }
    } catch (error) {
      try {
        await resolveBudgetCommitmentFailure({ request, error, user, req });
      } catch (unhandled) {
        // Anything else is left for Treasury's "Commit budget", with the reason.
        await recordAudit({ entityType: "FinancialRequest", entity: request, action: "BUDGET_COMMITMENT_DEFERRED", user, req, module: "BUDGET", message: unhandled.message, newValues: { code: unhandled.code } });
        await notifyRoles({
          roles: [ROLES.TREASURY],
          eventKey: `request:${request._id}:budget-commitment`,
          type: "BUDGET_COMMITMENT",
          title: notificationText("Budget commitment required"),
          message: notificationText("{requestNumber} completed its approval route, but the automatic budget commitment could not run: {detail}", { requestNumber: request.requestNumber, detail: unhandled.message }),
          path: `/requests/${request._id}`,
          entityType: "FinancialRequest",
          entityId: request._id
        });
      }
    }
  }
  return released;
}

export async function resolveBankNotices(request) {
  for (const key of bankNoticeKeys(request)) await resolveNotification(key);
}
