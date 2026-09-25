// LanguageProvider keeps <html lang> in sync with the selected language, so
// callers without a `language` argument still format in the app's language.
function currentLanguage() {
  if (typeof document !== "undefined" && document.documentElement.lang) return document.documentElement.lang;
  try { return localStorage.getItem("erp_language") || "es"; } catch { return "es"; }
}

export function localeFor(language = currentLanguage()) {
  return language === "es" ? "es-PE" : "en-US";
}

export function formatNumber(value, language, options = {}) {
  return new Intl.NumberFormat(localeFor(language), options).format(Number(value || 0));
}

export function formatCurrency(value, currency = "PEN", language, options = {}) {
  return new Intl.NumberFormat(localeFor(language), {
    style: "currency",
    currency: currency || "PEN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options
  }).format(Number(value || 0));
}

export function formatDate(value, language, options = {}) {
  if (!value) return "-";
  // Calendar-only values must not move to the previous day in Peru's time zone.
  const date = new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...options
  }).format(date);
}

export function formatDateTime(value, language) {
  return formatDate(value, language, { hour: "2-digit", minute: "2-digit" });
}

export function formatPercent(value, language, options = {}) {
  return new Intl.NumberFormat(localeFor(language), {
    style: "percent",
    maximumFractionDigits: 1,
    ...options
  }).format(Number(value || 0));
}
