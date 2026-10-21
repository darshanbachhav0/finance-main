import { calendarDateKey, limaToday } from "./businessCalendar.mjs";

export const CREDIT_DAY_OPTIONS = Object.freeze({ CASH: 0, CREDIT_15: 15, CREDIT_30: 30, CREDIT_45: 45, CREDIT_60: 60 });

export function supplierCreditDays(terms) {
  if (!terms?.option) return null;
  const days = terms.option === "CUSTOM" ? terms.days : CREDIT_DAY_OPTIONS[terms.option];
  return ["number", "string"].includes(typeof days) && String(days).trim() !== "" && Number.isSafeInteger(Number(days)) && Number(days) >= 0 ? Number(days) : null;
}

// Date-only commercial dates retain their day; timed values are interpreted in Lima.
export function invoiceDueDate(issueDate, terms = {}) {
  if (!issueDate) return null;
  const key = calendarDateKey(issueDate);
  const start = new Date(`${key}T00:00:00Z`);
  if (!key || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== key) return null;
  const days = terms.paymentCondition === "CREDIT" && terms.creditStart === "INVOICE" ? terms.creditDays
    : terms.paymentCondition === "100%_ADVANCE" ? 0
    : terms.paymentCondition ? null : supplierCreditDays(terms);
  if (days == null || days === "" || !Number.isSafeInteger(Number(days)) || Number(days) < 0) return null;
  start.setUTCDate(start.getUTCDate() + Number(days));
  if (!Number.isFinite(start.getTime())) return null;
  return start.toISOString().slice(0, 10);
}

export function invoiceStatus(payable, now = new Date()) {
  if (payable.status === "PAID") return "Pagada";
  const due = payable.dueDate && calendarDateKey(payable.dueDate);
  const today = limaToday(now);
  if (!due || payable.outstandingAmount <= 0 || payable.status === "CANCELLED") return "Pendiente";
  if (due < today) return "Vencida";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 7);
  return due <= limit.toISOString().slice(0, 10) ? "Por vencer" : "Pendiente";
}

export const scheduledPaymentDate = payable => payable?.scheduledFor || payable?.plannedPaymentDate || null;
