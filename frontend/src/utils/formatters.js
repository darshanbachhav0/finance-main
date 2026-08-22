export function localeFor(language) {
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
  const date = new Date(value);
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
