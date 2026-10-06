// Accounts Payable presentation rules (plain JavaScript so the node tests can import them).

export const voucherLabel = (row) => `${row.voucher?.voucherType || row.voucher?.documentType || "-"} ${row.voucher?.series || ""}-${row.voucher?.number || ""}`;
export const supplierLabel = (row) => row.supplier?.legalName || row.supplier?.name || "UMA collaborator";

// The pending SPOT deposit is paid to the supplier's Banco de la Nacion account, so the bank
// transfer is the outstanding amount minus that deposit (as treasuryService computes it).
export function netTransfer(row) {
  const pending = row.detraction?.status === "PENDING" ? Number(row.detraction.amount || 0) : 0;
  return Math.max(0, Math.round((Number(row.outstandingAmount || 0) - pending) * 100) / 100);
}

// Why "Cancel unpaid CXP" is not available; empty when it is. Mirrors the server's rule.
export function cancelBlockedReason(row) {
  if (!["OPEN", "SCHEDULED"].includes(row.status)) return "Only an unpaid CXP that is not in a bank file can be cancelled.";
  if (row.adjustments?.length) return "A credit or debit note was applied to this CXP, so it can no longer be cancelled.";
  if (row.supplierCreditApplications?.length) return "A supplier credit was applied to this CXP, so it can no longer be cancelled.";
  if (row.detraction?.status === "DEPOSITED") return "The detraction was already deposited, so this CXP can no longer be cancelled.";
  return "";
}
