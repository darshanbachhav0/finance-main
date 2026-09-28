import { addBusinessDays, businessDaysBetween, isBusinessDay, nextBusinessDay } from "../../../shared/businessCalendar.mjs";

// Extra non-working days beyond the national holidays (government-decreed days off,
// university closures), as comma-separated YYYY-MM-DD in UMA_EXTRA_HOLIDAYS.
export function calendarOptions() {
  const extraHolidays = String(process.env.UMA_EXTRA_HOLIDAYS || "").split(",").map((item) => item.trim()).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  return { extraHolidays };
}

export const workingDay = (value) => isBusinessDay(value, calendarOptions());
export const nextWorkingDay = (value) => nextBusinessDay(value, calendarOptions());
export const addWorkingDays = (value, days) => addBusinessDays(value, days, calendarOptions());
export const workingDaysBetween = (from, to) => businessDaysBetween(from, to, calendarOptions());
