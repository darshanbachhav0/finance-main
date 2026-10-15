const UNITS = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

// "2 days ago" / "hace 2 días", in the interface language.
export function timeAgo(value, language = "es", now = new Date()) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(language === "en" ? "en" : "es", { numeric: "auto" });
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}
