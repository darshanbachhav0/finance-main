import { isPaymentCycleDate, limaDateKey, nextPaymentCycleDate } from "../../../shared/businessCalendar.mjs";

const DAY_MS = 86400000;

// "today" on a payment-cycle date (15th / 30th, Lima), "tomorrow" the day before one, else null.
export function paymentDayState(now = new Date()) {
  if (isPaymentCycleDate(now)) return "today";
  if (isPaymentCycleDate(new Date(now.getTime() + DAY_MS))) return "tomorrow";
  return null;
}

// The next payment-cycle date strictly after today when today's run is already decided (after
// Treasury generated today's file), otherwise on or after today. Returned as "YYYY-MM-DD".
export function upcomingPaymentDate(now = new Date(), { includeToday = true } = {}) {
  const today = limaDateKey(now);
  const next = nextPaymentCycleDate(now);
  if (includeToday || next !== today) return next;
  return nextPaymentCycleDate(new Date(now.getTime() + DAY_MS));
}
