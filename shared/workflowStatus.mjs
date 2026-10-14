export const REQUEST_LIFECYCLE = Object.freeze([
  "BORRADOR", "PENDIENTE_APROBACION", "APROBADO",
  "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "CERRADO"
]);
export const LEGACY_WORKFLOW_STATUSES = Object.freeze({
  PAGADO_CERRADO: "CERRADO", LIQUIDADO_CERRADO: "CERRADO",
  PROVISIONADO_CXP: "CONTABILIZADO", PROCESADO_BANCO: "TXT_GENERADO", RENDICION_PENDIENTE: "PAGADO",
  ENVIADO: "PENDIENTE_APROBACION", EN_VALIDACION: "PENDIENTE_APROBACION"
});
export const canonicalRequestStatus = status => LEGACY_WORKFLOW_STATUSES[status] || status;
export const isTerminalRequest = status => ["RECHAZADO", "ANULADO", "CERRADO"].includes(canonicalRequestStatus(status));
export const statusAliases = status => [status, ...Object.keys(LEGACY_WORKFLOW_STATUSES).filter(key => LEGACY_WORKFLOW_STATUSES[key] === status)];
export const terminalStatusValues = [...statusAliases("CERRADO"), "RECHAZADO", "ANULADO"];
const id = value => String(value?._id || value || "");
const posted = journal => Boolean(journal) && (typeof journal !== "object" || journal.status === "POSTED");
const amount = value => Math.round(Number(value || 0) * 100);
export function renditionPending(request) {
  return (request.flowType === "C" || request.requestType === "ENTREGA_RENDIR")
    && !isTerminalRequest(request.status)
    && ["PENDING", "SUBMITTED", "OBSERVED"].includes(request.rendition?.status);
}

// A REJECTED rendition owes nothing once its advance was fully RECOVERED (reimbursement or payroll
// deduction), or when the beneficiary had already handed the whole paid advance back with the
// rendition, so the rejection left nothing to recover (NOT_APPLICABLE with the amounts to prove it).
// The default NOT_APPLICABLE of a recovery that was never computed carries no advance and is not settled.
export function rejectedRenditionSettled(rendition) {
  if (rendition?.status !== "REJECTED") return false;
  const recovery = rendition.recovery || {};
  if (recovery.status === "RECOVERED") return true;
  return recovery.status === "NOT_APPLICABLE" && amount(recovery.advanceAmount) > 0
    && amount(recovery.returnedAmount) === amount(recovery.advanceAmount) && amount(recovery.outstandingAmount) === 0;
}

// A Track C advance is settled for closure once its rendition is VALIDATED with nothing left to
// render/return, or once a REJECTED rendition owes nothing (rejectedRenditionSettled). Requests
// without a rendition obligation are always settled here.
export function renditionSettledForClosure(request) {
  if (!(request?.flowType === "C" || request?.requestType === "ENTREGA_RENDIR")) return true;
  const rendition = request.rendition || {};
  if (rendition.status === "VALIDATED") return amount(rendition.balanceOutstanding) === 0;
  return rejectedRenditionSettled(rendition);
}

// Derive progress from financial evidence, never from the parent status alone.
export function deriveFinancialProgress(request, payables = [], reconciliations = [], purchaseOrder = null, vouchers = []) {
  const active = payables.filter(ap => ap.status !== "CANCELLED");
  const confirmations = request.payment?.confirmations || [];
  const counts = { total: active.length, accounted: 0, scheduled: 0, fileGenerated: 0, paid: 0, partiallyPaid: 0, reconciled: 0 };
  const cents = { total: 0, paid: 0, paidToDate: 0, reconciled: 0 };
  const children = active.map(ap => {
    // Multiple confirmations can now target the same AP (partial payments), so sum every
    // confirmation for this child instead of trusting a single match.
    const apConfirmations = confirmations.filter(item => id(item.accountsPayable) === id(ap));
    const relevant = apConfirmations.length ? apConfirmations : (active.length === 1 && request.payment?.confirmedAmount ? [request.payment] : []);
    const confirmedCents = relevant.reduce((sum, item) => sum + amount(item?.amount ?? item?.confirmedAmount), 0);
    const hasCompleteRecord = relevant.length > 0 && relevant.every(item => item?.confirmedAt && item?.operationNumber && item?.paidAt);
    const paid = ap.status === "PAID" && Boolean(posted(ap.paymentJournal) && ap.paidDate && hasCompleteRecord
      && confirmedCents === amount(ap.originalAmount) && amount(ap.outstandingAmount) === 0);
    const partiallyPaid = !paid && (ap.status === "PARTIALLY_PAID" || confirmedCents > 0);
    const reconciled = paid && reconciliations.some(record => {
      const covered = new Set([record.accountsPayable, ...(record.accountsPayables || [])].filter(Boolean).map(id));
      const coveredTotal = payables.filter(child => covered.has(id(child))).reduce((total, child) => total + amount(child.originalAmount), 0);
      return covered.has(id(ap)) && record.reconciledAt && record.bankReference && amount(record.difference) === 0
        && amount(record.paidAmount) === coveredTotal && amount(record.statementAmount) === coveredTotal;
    });
    const batch = ap.paymentBatch;
    const fileGenerated = paid || Boolean(["PAYMENT_FILE_CREATED", "PAID", "PARTIALLY_PAID"].includes(ap.status)
      && batch?.checksum && batch?.generatedAt && batch.items?.some(item => id(item.accountsPayable) === id(ap) && !["CANCELLED", "REPROGRAMMED", "REJECTED"].includes(item.status)));
    const scheduled = fileGenerated || Boolean(ap.status === "SCHEDULED" && ap.bankAccountSnapshot?.bank
      && (ap.scheduledFor || ap.history?.some(item => item.status === "SCHEDULED")));
    const accounted = posted(ap.provisionJournal);
    counts.accounted += Number(accounted); counts.scheduled += Number(scheduled);
    counts.fileGenerated += Number(fileGenerated); counts.paid += Number(paid); counts.partiallyPaid += Number(partiallyPaid); counts.reconciled += Number(reconciled);
    cents.total += amount(ap.originalAmount); if (paid) cents.paid += amount(ap.originalAmount); cents.paidToDate += confirmedCents; if (reconciled) cents.reconciled += amount(ap.originalAmount);
    return { id: id(ap), accounted, scheduled, fileGenerated, paid, partiallyPaid, reconciled, outstandingAmount: ap.outstandingAmount };
  });
  // A voucher that never posted and was annulled (its invoice observation dismissed) is not pending accounting.
  const unaccountedVouchers = vouchers.filter(v => !v.accountsPayable && !v.supersededBy && v.validationStatus !== "ANNULLED").length;
  // Informational only: a Purchase Order may still hold an uninvoiced balance. It no longer
  // blocks closure - closing the request means invoicing is complete, so the remaining order
  // balance is cancelled and its budget commitment released at that point.
  const orderOpen = Boolean(purchaseOrder && ["ISSUED", "PARTIALLY_LIQUIDATED"].includes(purchaseOrder.status || "ISSUED") && Number(purchaseOrder.remainingAmount || 0) > 0);
  let status = null;
  if (counts.total && counts.accounted === counts.total && !unaccountedVouchers) {
    status = "CONTABILIZADO";
    if (counts.scheduled === counts.total) status = "PROGRAMADO";
    if (counts.fileGenerated === counts.total) status = "TXT_GENERADO";
    // Payment progress reflects existing obligations; an open PO separately blocks final closure.
    // A child only counts toward PAGADO once it is fully (not partially) settled.
    if (counts.paid === counts.total) status = "PAGADO";
    if (counts.reconciled === counts.total) status = "CONCILIADO";
  }
  return { status, counts, amounts: Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100])),
    currency: request.currency, orderOpen, unaccountedVouchers, children,
    renditionStatus: renditionPending(request) ? "RENDICION_PENDIENTE" : request.rendition?.status,
    partialPayment: (counts.paid > 0 && counts.paid < counts.total) || counts.partiallyPaid > 0 };
}
