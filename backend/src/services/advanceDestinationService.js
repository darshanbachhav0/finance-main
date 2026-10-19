import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { isAdvancePayable } from "./advancePaymentService.js";
import { recordAudit } from "./auditService.js";
import { getVerifiedEmployeeReimbursementBankAccount } from "./employeeReimbursementBankService.js";
import { notificationText, notifyRoles } from "./notificationService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../utils/constants.js";

// An approved advance pays into the employee account captured at approval. While nothing of it is
// scheduled or in a bank file yet, that destination can still follow the employee's current
// verified account (the preferred one, or the only verified one in the currency): automatically
// when Accounting verifies a corrected account, or when Treasury asks for it.
const SNAPSHOT_FIELDS = "+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci";
const ownerOf = (request) => request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
const lastDigits = (value) => String(value || "").slice(-4);

// Nothing paid, scheduled or in a file: every live payable of the advance is OPEN with no frozen account.
async function destinationCanChange(request) {
  const payables = await AccountsPayable.find({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } }).select("status bankAccountSnapshot.bank flowType voucher.voucherType");
  return payables.length > 0 && payables.every((payable) => isAdvancePayable(payable) && payable.status === AP_STATUS.OPEN && !payable.bankAccountSnapshot?.bank);
}

async function pointAdvanceAt(request, profile, { user, req, manual }) {
  const previous = request.rendition?.reimbursementBankSnapshot || {};
  if (String(previous.profile || "") === String(profile._id) && previous.verificationStatus === "VERIFIED") return false;
  request.rendition.reimbursementBankSnapshot = {
    profile: profile._id, bank: profile.bank, currency: profile.currency, accountHolderName: profile.accountHolderName,
    accountNumber: profile.accountNumber, cci: profile.cci, verificationStatus: profile.verificationStatus, capturedAt: new Date()
  };
  request.markModified("rendition.reimbursementBankSnapshot");
  await request.save();
  await recordAudit({
    entityType: "FinancialRequest", entity: request, action: "ADVANCE_DESTINATION_REFRESHED", user, req, module: "TREASURY",
    message: manual ? "Treasury switched the unpaid advance to the employee's current verified bank account." : "The employee's corrected bank account was verified; the unpaid advance now pays to it.",
    oldValues: { profile: previous.profile, bank: previous.bank, accountEnding: lastDigits(previous.accountNumber) },
    newValues: { profile: profile._id, bank: profile.bank, accountEnding: lastDigits(profile.accountNumber) }
  });
  await notifyRoles({
    roles: [ROLES.TREASURY],
    eventKey: `request:${request._id}:destination-refreshed:${profile._id}`,
    type: "TREASURY_PAYMENT",
    title: notificationText("Advance bank account updated"),
    message: notificationText("{requestNumber}: the advance now pays to {name}'s verified {bank} account ending in {ending}.", {
      requestNumber: request.requestNumber, name: profile.accountHolderName || request.rendition?.beneficiarySnapshot?.name || "", bank: profile.bank, ending: lastDigits(profile.accountNumber)
    }),
    path: "/treasury?advances=due",
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return true;
}

// Every unpaid advance of the employee in that currency follows their current verified account.
export async function refreshUnpaidAdvanceDestinations({ userId, currency, user, req }) {
  const profile = await getVerifiedEmployeeReimbursementBankAccount({ userId, currency });
  if (!profile) return [];
  const candidates = await FinancialRequest.find({
    $or: [{ requester: userId }, { solicitor: userId }],
    flowType: FLOW_TYPE.C,
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    status: REQUEST_STATUS.ACCOUNTED,
    currency,
    "rendition.reimbursementBankSnapshot.profile": { $exists: true }
  }).select(SNAPSHOT_FIELDS);
  const refreshed = [];
  for (const request of candidates) {
    if (!(await destinationCanChange(request))) continue;
    if (await pointAdvanceAt(request, profile, { user, req, manual: false })) refreshed.push(request.requestNumber);
  }
  return refreshed;
}

// Treasury's "Use current bank account" on one advance payable.
export async function useCurrentBankAccountForAdvance({ accountsPayableId, user, req }) {
  const payable = await AccountsPayable.findById(accountsPayableId).select("request status bankAccountSnapshot.bank flowType voucher.voucherType currency");
  if (!payable) throw new AppError(404, "Accounts payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  if (!isAdvancePayable(payable)) throw new AppError(422, "Only an advance can switch to the employee's current bank account.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const request = await FinancialRequest.findById(payable.request).select(SNAPSHOT_FIELDS);
  if (!request || !(await destinationCanChange(request))) {
    throw new AppError(409, "This advance is already scheduled or in a bank file; its bank account can no longer change here.", undefined, ERROR_CODES.PAYMENT_DESTINATION_LOCKED);
  }
  const profile = await getVerifiedEmployeeReimbursementBankAccount({ userId: ownerOf(request), currency: payable.currency || request.currency });
  if (!profile) throw new AppError(422, "The employee has no verified bank account in this currency. Accounting verifies it in Reimbursement Banking.", { currency: payable.currency }, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
  const changed = await pointAdvanceAt(request, profile, { user, req, manual: true });
  return { changed, requestNumber: request.requestNumber, bank: profile.bank, accountEnding: lastDigits(profile.accountNumber) };
}
