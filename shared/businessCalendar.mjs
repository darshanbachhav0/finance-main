// Peruvian working-day calendar shared by approval SLAs, rendition deadlines and the
// treasury payment cycle. Every calculation happens in Lima local time (UTC-5, no DST),
// so a deadline never shifts because the server runs in another timezone.
const LIMA_OFFSET_MS = -5 * 3600000;
const DAY_MS = 86400000;
// The platform's time zone: dates and times are shown and decided in Lima on every device.
export const LIMA_TIME_ZONE = "America/Lima";

// National holidays with a fixed date (Ley 27403 and later additions:
// 7 Jun and 6 Aug and 9 Dec since 2022, 23 Jul since 2023).
const FIXED_HOLIDAYS = Object.freeze([
  { monthDay: "01-01", name: "Año Nuevo" },
  { monthDay: "05-01", name: "Día del Trabajo" },
  { monthDay: "06-07", name: "Batalla de Arica y Día de la Bandera", from: 2022 },
  { monthDay: "06-29", name: "San Pedro y San Pablo" },
  { monthDay: "07-23", name: "Día de la Fuerza Aérea del Perú", from: 2023 },
  { monthDay: "07-28", name: "Fiestas Patrias" },
  { monthDay: "07-29", name: "Fiestas Patrias" },
  { monthDay: "08-06", name: "Batalla de Junín", from: 2022 },
  { monthDay: "08-30", name: "Santa Rosa de Lima" },
  { monthDay: "10-08", name: "Combate de Angamos" },
  { monthDay: "11-01", name: "Todos los Santos" },
  { monthDay: "12-08", name: "Inmaculada Concepción" },
  { monthDay: "12-09", name: "Batalla de Ayacucho", from: 2022 },
  { monthDay: "12-25", name: "Navidad" }
]);

const pad = (value) => String(value).padStart(2, "0");

// Lima calendar date of an instant, as "YYYY-MM-DD".
export function limaDateKey(value) {
  const shifted = new Date(new Date(value).getTime() + LIMA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// Today in Lima, as "YYYY-MM-DD" (its first 7 characters are the current period).
export function limaToday(now = new Date()) {
  return limaDateKey(now);
}

// Calendar day of a stored value, as "YYYY-MM-DD". Date-only values ("YYYY-MM-DD" strings and
// dates stored at 00:00 UTC, such as issue, invoice and accounting dates) keep their own day;
// any other instant is read in Lima.
export function calendarDateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  return time % DAY_MS === 0 ? new Date(time).toISOString().slice(0, 10) : limaDateKey(time);
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const utcKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export function peruHolidays(year) {
  const easter = easterSunday(year);
  return [
    ...FIXED_HOLIDAYS.filter((item) => !item.from || year >= item.from).map((item) => ({ date: `${year}-${item.monthDay}`, name: item.name })),
    { date: utcKey(easter - 3 * DAY_MS), name: "Jueves Santo" },
    { date: utcKey(easter - 2 * DAY_MS), name: "Viernes Santo" }
  ].sort((left, right) => left.date.localeCompare(right.date));
}

// extraHolidays: additional "YYYY-MM-DD" non-working days (e.g. days decreed by the
// government or university closures), configured by the institution.
export function isBusinessDay(value, { extraHolidays = [] } = {}) {
  const key = limaDateKey(value);
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = Number(key.slice(0, 4));
  return !peruHolidays(year).some((item) => item.date === key) && !extraHolidays.includes(key);
}

// Moves forward to the first working day, keeping the Lima time of day.
export function nextBusinessDay(value, options) {
  let current = new Date(value);
  while (!isBusinessDay(current, options)) current = new Date(current.getTime() + DAY_MS);
  return current;
}

// Adds `days` working days, keeping the Lima time of day. A start on a non-working day
// counts from the next working day, so "1 business day" from Saturday is Tuesday's
// equivalent of Monday + 1.
export function addBusinessDays(value, days, options) {
  let current = nextBusinessDay(value, options);
  let remaining = Math.max(0, Math.ceil(Number(days) || 0));
  while (remaining > 0) {
    current = new Date(current.getTime() + DAY_MS);
    if (isBusinessDay(current, options)) remaining -= 1;
  }
  return current;
}

// Working days elapsed after `from` up to and including `to` (0 when `to` is not later).
export function businessDaysBetween(from, to, options) {
  const end = limaDateKey(to);
  let current = new Date(from);
  let count = 0;
  while (limaDateKey(current) < end) {
    current = new Date(current.getTime() + DAY_MS);
    if (isBusinessDay(current, options)) count += 1;
  }
  return count;
}

// University payment cycle (Manual técnico, "Programación de pagos"): payments run on the 15th and
// on the last day of the month, each moved back to the previous working day when it falls on a
// weekend or holiday. Returns the first cycle date on or after `value`, as a Lima date key.
const noonOf = (key) => new Date(`${key}T12:00:00.000Z`);

function previousBusinessDayKey(key, options) {
  let time = noonOf(key).getTime();
  while (!isBusinessDay(time, options)) time -= DAY_MS;
  return limaDateKey(time);
}

// The two payment days of a month (1-12), as Lima date keys.
export function paymentCycleDatesOfMonth(year, month, options) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [previousBusinessDayKey(`${year}-${pad(month)}-15`, options), previousBusinessDayKey(`${year}-${pad(month)}-${pad(lastDay)}`, options)];
}

// The next `count` payment days on or after `value`.
export function paymentCycleDatesFrom(value, count = 6, options) {
  const key = limaDateKey(value);
  let year = Number(key.slice(0, 4)), month = Number(key.slice(5, 7));
  const out = [];
  while (out.length < count) {
    for (const date of paymentCycleDatesOfMonth(year, month, options)) if (date >= key && out.length < count) out.push(date);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

export function nextPaymentCycleDate(value, options) {
  return paymentCycleDatesFrom(value, 1, options)[0];
}

export function isPaymentCycleDate(value, options) {
  const key = limaDateKey(value);
  return paymentCycleDatesOfMonth(Number(key.slice(0, 4)), Number(key.slice(5, 7)), options).includes(key);
}

// The weekly urgency window: the next Wednesday after `value` (the next working day if that
// Wednesday is a holiday).
export function nextUrgencyPaymentDate(value, options) {
  let time = noonOf(limaDateKey(value)).getTime() + DAY_MS;
  while (new Date(time).getUTCDay() !== 3) time += DAY_MS;
  return limaDateKey(nextBusinessDay(time, options));
}

export function isUrgencyPaymentDate(value, options) {
  const time = noonOf(limaDateKey(value));
  return time.getUTCDay() === 3 && isBusinessDay(time, options);
}

// The payment day the platform proposes for a request (ventanaSug in the GAF pilot): P1 today, P2
// the next urgency Wednesday, otherwise the first payment day at least `cutoffWorkingDays` working
// days away; with a due date, P3 and P4 move to the last payment day on or before it.
export function suggestedPaymentDate({ priority = "P3", dueDate = null, now = new Date(), cutoffWorkingDays = 3, ...options } = {}) {
  const today = limaDateKey(now);
  if (priority === "P1") return limaDateKey(nextBusinessDay(noonOf(today), options));
  if (priority === "P2") return nextUrgencyPaymentDate(now, options);
  const upcoming = paymentCycleDatesFrom(now, 10, options);
  const first = upcoming.find((date) => businessDaysBetween(noonOf(today), noonOf(date), options) >= cutoffWorkingDays) || upcoming.at(-1);
  if (dueDate) {
    const due = calendarDateKey(dueDate);
    const beforeDue = paymentCycleDatesFrom(noonOf(first), 8, options).filter((date) => date <= due);
    if (beforeDue.length) return beforeDue.at(-1);
  }
  return first;
}

// Advances to render are paid the same working day they are approved: today (Lima) when it is a
// working day and the approval came before the cut-off hour, otherwise the next working day.
// Returns a Lima date key.
export const ADVANCE_CUTOFF_HOUR = 15;
export function advancePaymentDate(value = new Date(), { cutoffHour = ADVANCE_CUTOFF_HOUR, ...options } = {}) {
  const time = new Date(value).getTime();
  const limaHour = new Date(time + LIMA_OFFSET_MS).getUTCHours();
  const afterCutoff = isBusinessDay(time, options) && limaHour >= cutoffHour;
  return limaDateKey(nextBusinessDay(afterCutoff ? time + DAY_MS : time, options));
}
