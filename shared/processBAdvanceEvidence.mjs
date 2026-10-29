// Source: UMA payment manuals: after an advance is paid, acta within 30 days,
// supplier's invoice within 15 days. These are calendar-day follow-up alerts.
// They do not alter Track C's separate rendition deadline.
function limaDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function plusCalendarDays(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
export function processBAdvanceEvidence(request, now = new Date()) {
  if (request?.flowType !== "B" || !["100%_ADVANCE", "ADVANCE_AND_BALANCE"].includes(request.supplierPaymentTerms?.paymentCondition)) return null;
  const paidAt = limaDate(request.payment?.paidAt);
  if (!paidAt) return null;
  const today = limaDate(now);
  const invoiceDue = plusCalendarDays(paidAt, 15);
  const actaDue = plusCalendarDays(paidAt, 30);
  const invoiceComplete = Boolean(request.xmlValidation?.validated);
  const actaComplete = request.digitalActa?.status === "COMPLETE" && request.digitalActa?.conformity === "TOTAL";
  return {
    paidAt, invoiceDue, actaDue, invoiceComplete, actaComplete,
    invoiceOverdue: !invoiceComplete && today > invoiceDue,
    actaOverdue: !actaComplete && today > actaDue
  };
}
