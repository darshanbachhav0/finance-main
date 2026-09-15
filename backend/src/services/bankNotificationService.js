import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import { ROLES } from "../utils/constants.js";

const reviewKey = (account) => `employee-bank:${account._id}:review`;
const reference = (account) => ({
  path: `/reimbursement-bank?record=${account._id}`,
  entityType: "EmployeeReimbursementBankAccount", entityId: account._id
});

export async function notifyEmployeeBankReview(account) {
  return notifyRoles({
    roles: [ROLES.ACCOUNTING, ROLES.ADMIN], eventKey: reviewKey(account),
    type: "EMPLOYEE_BANK_REVIEW", title: "Reimbursement bank profile awaiting review",
    message: `${account.bank} / ${account.currency}: a reimbursement bank profile needs Accounting verification.`,
    ...reference(account)
  });
}

export async function resolveEmployeeBankReview(account) {
  return resolveNotification(reviewKey(account));
}

export async function notifyEmployeeBankDecision(account) {
  await resolveEmployeeBankReview(account);
  return notifyUser({
    userId: account.user?._id || account.user,
    eventKey: `employee-bank:${account._id}:decision:${account.verifiedAt.toISOString()}`,
    type: "EMPLOYEE_BANK_DECISION", title: "Reimbursement bank profile reviewed",
    message: `${account.bank} / ${account.currency}: ${account.verificationStatus}. Open the profile to see the review.`,
    ...reference(account)
  });
}
