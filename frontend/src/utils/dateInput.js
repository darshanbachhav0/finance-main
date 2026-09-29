// Date helpers for DateInput / MonthInput. The UI always shows day-first Peruvian dates
// (dd/mm/aaaa, mm/aaaa) while forms keep the ISO values the API already uses
// ("YYYY-MM-DD" and "YYYY-MM"). Everything here is pure so it can be tested in node.

const pad = (value) => String(value).padStart(2, "0");
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

export const MONTH_NAMES = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
};
export const MONTH_SHORT = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
};
// Monday-first week, as used in Peru.
export const WEEKDAY_SHORT = {
  es: ["lu", "ma", "mi", "ju", "vi", "sá", "do"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
};
export const WEEKDAY_NAMES = {
  es: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
};

const lang = (language) => (language === "en" ? "en" : "es");
export const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : "");

/** Placeholder shown in empty fields: "dd/mm/aaaa" in Spanish, "dd/mm/yyyy" in English. */
export function datePlaceholder(language, kind = "date") {
  const year = lang(language) === "en" ? "yyyy" : "aaaa";
  return kind === "month" ? `mm/${year}` : `dd/mm/${year}`;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Local calendar date as ISO (not UTC: late evening in Lima is still "today"). */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function validParts(year, month, day) {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12 && (day === undefined || (day >= 1 && day <= daysInMonth(year, month)));
}

/** Normalizes "2026-09-30", "2026-09-30T05:00:00.000Z" or a Date to "2026-09-30"; invalid -> "". */
export function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return "";
  const [year, month, day] = match.slice(1).map(Number);
  return validParts(year, month, day) ? match.slice(1).join("-") : "";
}

export function toIsoMonth(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})/.exec(String(value));
  if (!match) return "";
  return validParts(Number(match[1]), Number(match[2])) ? `${match[1]}-${match[2]}` : "";
}

/** "2026-09-30" -> "30/09/2026". */
export function formatIsoDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/** "2026-09" -> "09/2026". */
export function formatIsoMonth(value) {
  const iso = toIsoMonth(value);
  if (!iso) return "";
  const [year, month] = iso.split("-");
  return `${month}/${year}`;
}

/**
 * Keeps typed text in the dd/mm/aaaa shape: digits only, slashes added automatically, a
 * single digit followed by a separator is zero-padded ("1/" -> "01/"), and a pasted ISO
 * date is converted. `previous` tells a deletion apart so backspace can remove a slash.
 */
export function maskDateText(raw, previous = "") {
  let text = String(raw ?? "");
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  // While deleting, a slash is only kept when the text still ends with one.
  const keepSlash = !(text.length < String(previous).length) || /\/$/.test(text);
  text = text.replace(/^(\d)[^\d]/, "0$1/").replace(/^(\d{2})[^\d]+(\d)[^\d]/, "$1/0$2/");
  const digits = text.replace(/\D/g, "").slice(0, 8);
  let result = digits.slice(0, 2);
  if (digits.length > 2 || (digits.length === 2 && keepSlash)) result += "/";
  if (digits.length > 2) result += digits.slice(2, 4);
  if (digits.length > 4 || (digits.length === 4 && keepSlash)) result += "/";
  if (digits.length > 4) result += digits.slice(4);
  return result;
}

/** Same as maskDateText for mm/aaaa. */
export function maskMonthText(raw, previous = "") {
  let text = String(raw ?? "");
  const iso = /^\s*(\d{4})-(\d{2})/.exec(text);
  if (iso) return `${iso[2]}/${iso[1]}`;
  const keepSlash = !(text.length < String(previous).length) || /\/$/.test(text);
  text = text.replace(/^(\d)[^\d]/, "0$1/");
  const digits = text.replace(/\D/g, "").slice(0, 6);
  let result = digits.slice(0, 2);
  if (digits.length > 2 || (digits.length === 2 && keepSlash)) result += "/";
  if (digits.length > 2) result += digits.slice(2);
  return result;
}

/** On leaving the field, "30/09/26" becomes "30/09/2026" (two-digit years are 20xx). */
export function completeDateText(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(text || "").trim());
  return match ? `${match[1]}/${match[2]}/20${match[3]}` : String(text || "").trim();
}

export function completeMonthText(text) {
  const match = /^(\d{2})\/(\d{2})$/.exec(String(text || "").trim());
  return match ? `${match[1]}/20${match[2]}` : String(text || "").trim();
}

/**
 * Parses dd/mm/aaaa. Returns { iso, error }: error is "" (valid or empty), "incomplete"
 * (partial input) or "invalid" (no such day, e.g. 31/02/2026).
 */
export function parseDisplayDate(text) {
  const value = String(text || "").trim();
  if (!value) return { iso: "", error: "" };
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return { iso: "", error: /^[\d/]+$/.test(value) && value.replace(/\D/g, "").length < 8 ? "incomplete" : "invalid" };
  const [day, month, year] = match.slice(1).map(Number);
  if (!validParts(year, month, day)) return { iso: "", error: "invalid" };
  return { iso: `${match[3]}-${match[2]}-${match[1]}`, error: "" };
}

export function parseDisplayMonth(text) {
  const value = String(text || "").trim();
  if (!value) return { iso: "", error: "" };
  const match = /^(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return { iso: "", error: /^[\d/]+$/.test(value) && value.replace(/\D/g, "").length < 6 ? "incomplete" : "invalid" };
  if (!validParts(Number(match[2]), Number(match[1]))) return { iso: "", error: "invalid" };
  return { iso: `${match[2]}-${match[1]}`, error: "" };
}

/** "min" when the ISO value is before min, "max" when after max, "" otherwise. */
export function rangeError(iso, min, max) {
  if (!iso) return "";
  if (min && iso < min) return "min";
  if (max && iso > max) return "max";
  return "";
}

/** English message keys (translated with t) for a DateInput / MonthInput state. */
export function dateMessage(error, { kind = "date", min, max } = {}) {
  const month = kind === "month";
  if (error === "incomplete") return month ? "Complete the month (mm/yyyy)." : "Complete the date (dd/mm/yyyy).";
  if (error === "invalid") return month ? "Enter a valid month (mm/yyyy)." : "Enter a valid date (dd/mm/yyyy).";
  if (error === "min") return { key: month ? "The month must be {date} or later." : "The date must be {date} or later.", date: month ? formatIsoMonth(min) : formatIsoDate(min) };
  if (error === "max") return { key: month ? "The month must be {date} or earlier." : "The date must be {date} or earlier.", date: month ? formatIsoMonth(max) : formatIsoDate(max) };
  return "";
}

export function addDays(iso, amount) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return toIsoDate(date);
}

/** Adds months keeping the day when possible (31 Jan + 1 month -> 28/29 Feb). */
export function addMonths(iso, amount) {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** Monday = 0 ... Sunday = 6. */
export function weekdayIndex(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/**
 * The visible month as weeks of seven ISO days, Monday first, padded with the days of
 * the neighbouring months so every row is complete.
 */
export function calendarWeeks(year, month) {
  const first = `${year}-${pad(month)}-01`;
  let cursor = addDays(first, -weekdayIndex(first));
  const weeks = [];
  const last = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  while (cursor <= last || weeks.length === 0) {
    const week = [];
    for (let index = 0; index < 7; index += 1) {
      week.push({ iso: cursor, day: Number(cursor.slice(8)), inMonth: cursor.slice(0, 7) === first.slice(0, 7) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** "Septiembre 2026" / "September 2026" (calendar header). */
export function monthYearLabel(year, month, language) {
  const name = MONTH_NAMES[lang(language)][month - 1];
  return lang(language) === "en" ? `${name} ${year}` : `${capitalize(name)} ${year}`;
}

/** "miércoles, 30 de septiembre de 2026" / "Wednesday, 30 September 2026" (day labels). */
export function longDateLabel(iso, language) {
  const value = toIsoDate(iso);
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const code = lang(language);
  const weekday = WEEKDAY_NAMES[code][weekdayIndex(value)];
  return code === "en" ? `${weekday}, ${day} ${MONTH_NAMES.en[month - 1]} ${year}` : `${weekday}, ${day} de ${MONTH_NAMES.es[month - 1]} de ${year}`;
}
