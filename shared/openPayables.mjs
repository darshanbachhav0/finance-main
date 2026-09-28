// One definition of "open payables" / "pending payment", shared by the management portal
// (externalManagementService.js) and internal Reports (reportController.js) so both show the
// same number.
//
// A payable is open while it still has an outstanding balance in any not-yet-settled status:
// OPEN, SCHEDULED, PAYMENT_FILE_CREATED, PARTIALLY_PAID (counted at its outstanding balance, not
// its original amount) and PAYMENT_BOUNCED (the bank rejected the transfer, so it is still owed).
// PAID and CANCELLED payables are never open.
export const OPEN_PAYABLE_STATUSES = Object.freeze(["OPEN", "SCHEDULED", "PAYMENT_FILE_CREATED", "PARTIALLY_PAID", "PAYMENT_BOUNCED"]);

// Request statuses that never count in management figures (spend, CAPEX/OPEX, KPIs).
export const REPORTING_EXCLUDED_REQUEST_STATUSES = Object.freeze(["BORRADOR", "RECHAZADO", "ANULADO"]);

const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function isOpenPayable(payable) {
  return Boolean(payable) && OPEN_PAYABLE_STATUSES.includes(payable.status) && Number(payable.outstandingAmount || 0) > 0;
}

// Outstanding balance in PEN (outstanding amount in the payable's currency x its exchange rate).
export function openPayableAmountPEN(payable) {
  if (!isOpenPayable(payable)) return 0;
  return cents(Number(payable.outstandingAmount || 0) * Number(payable.exchangeRate || 1));
}

// MongoDB equivalents of the two functions above, for aggregation pipelines over AccountsPayable.
export function openPayableMatch(prefix = "") {
  return { [`${prefix}status`]: { $in: [...OPEN_PAYABLE_STATUSES] }, [`${prefix}outstandingAmount`]: { $gt: 0 } };
}

export const openPayableAmountPENExpression = Object.freeze({
  $multiply: [{ $ifNull: ["$outstandingAmount", 0] }, { $ifNull: ["$exchangeRate", 1] }]
});
