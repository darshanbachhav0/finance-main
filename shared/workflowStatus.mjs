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

// Derive progress from financial evidence, never from the parent status alone.
export function deriveFinancialProgress(request, payables = [], reconciliations = [], purchaseOrder = null, vouchers = []) {
  const active = payables.filter(ap => ap.status !== "CANCELLED");
  const confirmations = request.payment?.confirmations || [];
  const counts = { total: active.length, accounted: 0, scheduled: 0, fileGenerated: 0, paid: 0, reconciled: 0 };
  const cents = { total: 0, paid: 0, reconciled: 0 };
  const children = active.map(ap => {
    const confirmation = confirmations.find(item => id(item.accountsPayable) === id(ap))
      || (active.length === 1 ? request.payment : null);
    const confirmedAmount = confirmation?.amount ?? confirmation?.confirmedAmount;
    const paid = ap.status === "PAID" && Boolean(posted(ap.paymentJournal) && ap.paidDate && confirmation?.confirmedAt
      && confirmation?.operationNumber && confirmation?.paidAt
      && amount(confirmedAmount) === amount(ap.originalAmount) && amount(ap.outstandingAmount) === 0);
    const reconciled = paid && reconciliations.some(record => {
      const covered = new Set([record.accountsPayable, ...(record.accountsPayables || [])].filter(Boolean).map(id));
      const coveredTotal = payables.filter(child => covered.has(id(child))).reduce((total, child) => total + amount(child.originalAmount), 0);
      return covered.has(id(ap)) && record.reconciledAt && record.bankReference && amount(record.difference) === 0
        && amount(record.paidAmount) === coveredTotal && amount(record.statementAmount) === coveredTotal;
    });
    const batch = ap.paymentBatch;
    const fileGenerated = paid || Boolean(["PAYMENT_FILE_CREATED", "PAID"].includes(ap.status)
      && batch?.checksum && batch?.generatedAt && batch.items?.some(item => id(item.accountsPayable) === id(ap) && !["CANCELLED", "REPROGRAMMED", "REJECTED"].includes(item.status)));
    const scheduled = fileGenerated || Boolean(ap.status === "SCHEDULED" && ap.bankAccountSnapshot?.bank
      && (ap.scheduledFor || ap.history?.some(item => item.status === "SCHEDULED")));
    const accounted = posted(ap.provisionJournal);
    counts.accounted += Number(accounted); counts.scheduled += Number(scheduled);
    counts.fileGenerated += Number(fileGenerated); counts.paid += Number(paid); counts.reconciled += Number(reconciled);
    cents.total += amount(ap.originalAmount); if (paid) cents.paid += amount(ap.originalAmount); if (reconciled) cents.reconciled += amount(ap.originalAmount);
    return { id: id(ap), accounted, scheduled, fileGenerated, paid, reconciled };
  });
  const unaccountedVouchers = vouchers.filter(v => !v.accountsPayable && !v.supersededBy).length;
  const orderOpen = Boolean(purchaseOrder && Number(purchaseOrder.remainingAmount || 0) > 0);
  let status = null;
  if (counts.total && counts.accounted === counts.total && !unaccountedVouchers) {
    status = "CONTABILIZADO";
    if (counts.scheduled === counts.total) status = "PROGRAMADO";
    if (counts.fileGenerated === counts.total) status = "TXT_GENERADO";
    // Payment progress reflects existing obligations; an open PO separately blocks final closure.
    if (counts.paid === counts.total) status = "PAGADO";
    if (counts.reconciled === counts.total) status = "CONCILIADO";
  }
  return { status, counts, amounts: Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100])),
    currency: request.currency, orderOpen, unaccountedVouchers, children,
    renditionStatus: renditionPending(request) ? "RENDICION_PENDIENTE" : request.rendition?.status,
    partialPayment: counts.paid > 0 && counts.paid < counts.total };
}
