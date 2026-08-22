import SupplierBankAccount from "../models/SupplierBankAccount.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_TYPE } from "../utils/constants.js";

const reimbursementTypes = new Set([
  REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO,
  REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO,
  REQUEST_TYPE.ENTREGA_RENDIR
]);

export function isEligibleSupplierPaymentAccount(account, { bank, currency } = {}) {
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
  if (snapshot.bank !== bank || snapshot.currency !== currency) {
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
