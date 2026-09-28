import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { getVerifiedEmployeeReimbursementBankAccount } from "./employeeReimbursementBankService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_TYPE } from "../utils/constants.js";

const reimbursementTypes = new Set([
  REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO,
  REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO,
  REQUEST_TYPE.ENTREGA_RENDIR
]);

export function isEligibleSupplierPaymentAccount(account, { bank, currency } = {}) {
  // DETRACTION accounts are never a BBVA transfer destination: the SPOT deposit to Banco de la Nacion
  // is a separate Treasury step (recordDetractionDeposit), so only CURRENT accounts are eligible here.
  // An account flagged after a BANK_DETAILS bounce is OBSERVED and stays ineligible until re-verified.
  if (!account?.active || account.accountType !== "CURRENT") return false;
  if (bank && account.bank !== bank) return false;
  if (currency && account.currency !== currency) return false;
  if (account.verificationStatus === "VERIFIED") {
    return ["MATCH", "MANUAL_ACCEPTED"].includes(account.ownershipResult);
  }
  if (account.verificationStatus === "LEGACY_ACCEPTED") {
    return account.ownershipResult !== "MISMATCH";
  }
  return false;
}

export function supplierPaymentSnapshot(account) {
  return {
    sourceType: "SUPPLIER",
    bankAccountId: account._id,
    bank: account.bank,
    currency: account.currency,
    accountType: account.accountType,
    accountHolderName: account.accountHolderName,
    accountNumber: account.accountNumber,
    cci: account.cci,
    validFrom: account.validFrom,
    verificationStatus: account.verificationStatus,
    ownershipResult: account.ownershipResult,
    capturedAt: new Date()
  };
}

function employeePaymentSnapshot(request) {
  const source = request.rendition?.reimbursementBankSnapshot;
  if (!source?.profile) return null;
  return {
    sourceType: "EMPLOYEE_REIMBURSEMENT",
    employeeBankAccountId: source.profile,
    bank: source.bank,
    currency: source.currency,
    accountType: "CURRENT",
    accountHolderName: source.accountHolderName,
    accountNumber: source.accountNumber,
    cci: source.cci,
    verificationStatus: source.verificationStatus,
    ownershipResult: "MATCH",
    capturedAt: source.capturedAt
  };
}

export function usesEmployeeReimbursementDestination(request) {
  return reimbursementTypes.has(request.requestType) && Boolean(request.rendition?.reimbursementBankSnapshot?.profile);
}

export async function listEligibleSupplierPaymentAccounts({ supplierId, bank, currency }) {
  const query = { supplier: supplierId, active: true, accountType: "CURRENT" };
  if (bank) query.bank = bank;
  if (currency) query.currency = currency;
  const accounts = await SupplierBankAccount.find(query).sort({ preferred: -1, validFrom: -1, createdAt: -1 });
  return accounts.filter((account) => isEligibleSupplierPaymentAccount(account, { bank, currency }));
}

function assertSnapshotBatchMatch(snapshot, bank, currency) {
  if ((bank && snapshot.bank !== bank) || snapshot.currency !== currency) {
    throw new AppError(
      422,
      "The frozen payment destination does not match the selected bank and currency.",
      { destinationBank: snapshot.bank, destinationCurrency: snapshot.currency, bank, currency },
      ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE
    );
  }
}

export async function resolvePaymentDestination({ request, accountsPayable, bank, currency, selectedAccountId }) {
  const frozen = accountsPayable.bankAccountSnapshot;
  if (accountsPayable.status === "SCHEDULED" && frozen?.bank && (frozen.accountNumber || frozen.cci)) {
    const frozenId = frozen.bankAccountId || frozen.employeeBankAccountId;
    if (selectedAccountId && String(selectedAccountId) !== String(frozenId)) {
      throw new AppError(409, "The payment destination was frozen when the CXP was scheduled.", { selectedAccountId, frozenAccountId: frozenId }, ERROR_CODES.PAYMENT_DESTINATION_LOCKED);
    }
    assertSnapshotBatchMatch(frozen, bank, currency);
    const snapshot = frozen.toObject ? frozen.toObject() : { ...frozen };
    snapshot.sourceType ||= "SUPPLIER";
    return { snapshot, account: null, sourceType: snapshot.sourceType };
  }

  if (usesEmployeeReimbursementDestination(request)) {
    if (selectedAccountId) {
      throw new AppError(422, "An employee reimbursement uses its immutable rendition bank snapshot.", undefined, ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
    }
    const snapshot = employeePaymentSnapshot(request);
    if (snapshot.verificationStatus !== "VERIFIED") {
      throw new AppError(422, "The employee reimbursement destination is not verified.", { verificationStatus: snapshot.verificationStatus }, ERROR_CODES.REIMBURSEMENT_BANK_PENDING_VERIFICATION);
    }
    assertSnapshotBatchMatch(snapshot, bank, currency);
    return { snapshot, account: null, sourceType: snapshot.sourceType };
  }

  const eligible = await listEligibleSupplierPaymentAccounts({ supplierId: request.supplier._id || request.supplier, bank, currency });
  const account = selectedAccountId
    ? eligible.find((item) => String(item._id) === String(selectedAccountId))
    : eligible[0];
  if (!account) {
    throw new AppError(
      422,
      "No eligible verified current account matches this supplier, bank, and currency.",
      { supplier: request.supplier._id || request.supplier, bank, currency, selectedAccountId },
      selectedAccountId ? ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE : ERROR_CODES.BANK_DETAILS_MISSING
    );
  }
  return { snapshot: supplierPaymentSnapshot(account), account, sourceType: "SUPPLIER" };
}

// After a bounce: is the destination that bounced still a verified, eligible account? Used to
// decide whether a TECHNICAL bounce may be retried without a new signed CCI letter.
export async function bouncedDestinationStillVerified(accountsPayable, { session } = {}) {
  const snapshot = accountsPayable.bankAccountSnapshot;
  if (!snapshot?.bank) return false;
  if (snapshot.sourceType === "EMPLOYEE_REIMBURSEMENT") {
    if (!snapshot.employeeBankAccountId) return false;
    const account = await EmployeeReimbursementBankAccount.findById(snapshot.employeeBankAccountId).session(session || null).lean();
    return Boolean(account?.active && account.verificationStatus === "VERIFIED");
  }
  if (!snapshot.bankAccountId) return false;
  const account = await SupplierBankAccount.findById(snapshot.bankAccountId).session(session || null).lean();
  return isEligibleSupplierPaymentAccount(account, { currency: snapshot.currency });
}

// Flags the account a BANK_DETAILS bounce went to, so neither eligible[0] nor the employee snapshot
// can pick it again until Accounting re-verifies it. Returns what was flagged.
export async function flagBouncedDestination(accountsPayable, { reason, user, session } = {}) {
  const snapshot = accountsPayable.bankAccountSnapshot;
  const comments = `Payment bounced (bank details): ${reason}`.slice(0, 500);
  if (snapshot?.sourceType === "EMPLOYEE_REIMBURSEMENT" && snapshot.employeeBankAccountId) {
    await EmployeeReimbursementBankAccount.updateOne({ _id: snapshot.employeeBankAccountId }, { $set: { verificationStatus: "OBSERVED", verificationComments: comments, changedBy: user?._id } }, { session });
    return { sourceType: "EMPLOYEE_REIMBURSEMENT", accountId: snapshot.employeeBankAccountId };
  }
  if (snapshot?.bankAccountId) {
    await SupplierBankAccount.updateOne({ _id: snapshot.bankAccountId }, { $set: { verificationStatus: "OBSERVED", verificationComments: comments, changedBy: user?._id } }, { session });
    return { sourceType: "SUPPLIER", accountId: snapshot.bankAccountId, supplierId: accountsPayable.supplier?._id || accountsPayable.supplier };
  }
  return null;
}

// Track C / reimbursements: the frozen employee destination is re-read from the employee's current
// verified profile. Without one, the snapshot records the profile's real status so scheduling stays
// blocked (never a stale VERIFIED copy of an account that bounced).
export async function refreshEmployeeDestination(request, accountsPayable, { session } = {}) {
  if (!usesEmployeeReimbursementDestination(request)) return null;
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  const currency = accountsPayable.currency || request.currency || "PEN";
  const profile = await getVerifiedEmployeeReimbursementBankAccount({ userId: ownerId, currency, session });
  if (profile) {
    request.rendition.reimbursementBankSnapshot = {
      profile: profile._id, bank: profile.bank, currency: profile.currency, accountHolderName: profile.accountHolderName,
      accountNumber: profile.accountNumber, cci: profile.cci, verificationStatus: profile.verificationStatus, capturedAt: new Date()
    };
    return request.rendition.reimbursementBankSnapshot;
  }
  const current = await EmployeeReimbursementBankAccount.findById(request.rendition.reimbursementBankSnapshot.profile).select("verificationStatus active").session(session || null).lean();
  request.rendition.reimbursementBankSnapshot.verificationStatus = current?.active ? current.verificationStatus : "REJECTED";
  return request.rendition.reimbursementBankSnapshot;
}
