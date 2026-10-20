// Why a payment cannot go into the bank file, in plain words, and where it is fixed. The server
// sends paymentBlock (supplierPaymentBlock in backend/src/services/paymentDestinationService.js);
// a payment in another currency than the file is known here. English strings are the t() keys;
// Spanish lives in context/i18n/treasury.js.

export const PAYMENT_BLOCK_TEXT = {
  NO_ACCOUNT: "The supplier has no bank account. Register its {currency} current account with the CCI letter; Accounting verifies it.",
  PENDING_VERIFICATION: "The supplier's {currency} account is waiting for Accounting to verify it.",
  OBSERVED: "The supplier's {currency} account is observed, for example after a returned payment. Accounting verifies it again.",
  REJECTED: "The supplier's {currency} account was rejected or is not in the supplier's name. Register the supplier's own account; Accounting verifies it.",
  OTHER_CURRENCY: "The supplier only has a {others} account. Register a {currency} current account; Accounting verifies it.",
  DETRACTION_ONLY: "The supplier only has its Banco de la Nación detracciones account, which is never a transfer destination. Register a {currency} current account; Accounting verifies it.",
  INACTIVE: "The supplier's bank accounts are deactivated. Register a {currency} current account; Accounting verifies it.",
  NO_EMPLOYEE_ACCOUNT: "The employee has no verified bank account on this request. They register it in Reimbursement Banking; Accounting verifies it.",
  FILE_CURRENCY: "This payment is in {currency}. Choose {currency} as the file currency."
};

// null when the row gives no specific reason (the cell keeps the generic warning).
export function paymentBlockFor(row, fileCurrency) {
  const payableCurrency = row?.accountsPayable?.currency;
  if (payableCurrency && fileCurrency && payableCurrency !== fileCurrency) return { code: "FILE_CURRENCY", params: { currency: payableCurrency } };
  const block = row?.paymentBlock;
  if (!PAYMENT_BLOCK_TEXT[block?.code]) return null;
  const supplierId = row.supplier?._id;
  return {
    code: block.code,
    params: { currency: block.currency || payableCurrency || fileCurrency || "", others: block.others || "" },
    ...(supplierId && block.code !== "NO_EMPLOYEE_ACCOUNT" ? { href: `/suppliers/${supplierId}#supplier-section-banking-information` } : {})
  };
}
