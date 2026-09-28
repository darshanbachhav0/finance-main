import { formatDateTime } from "./formatters.js";

// Params holding codes or system text (approval levels, statuses, server reasons) are
// translated themselves; names, numbers and user comments are shown as written.
const TRANSLATED_PARAMS = new Set(["approvalLevel", "stage", "verificationStatus", "detail"]);
const DATE_TIME_PARAMS = new Set(["dueAt"]);

function paramValue(t, name, value) {
  if (value === undefined || value === null) return "";
  if (TRANSLATED_PARAMS.has(name)) return t(String(value));
  if (DATE_TIME_PARAMS.has(name) && !Number.isNaN(new Date(value).getTime())) return formatDateTime(value);
  return String(value);
}

// Translates a stored notification template (titleKey / messageKey) and then fills in
// its {placeholders}. Older notifications without a key fall back to t(text).
export function notificationCopy(t, key, params, fallback) {
  if (!key) return t(fallback);
  return t(key).replace(/\{(\w+)\}/g, (match, name) => (params && Object.hasOwn(params, name) ? paramValue(t, name, params[name]) : match));
}

export function notificationTitle(t, item) {
  return notificationCopy(t, item.titleKey, item.params, item.title);
}

export function notificationMessage(t, item) {
  return notificationCopy(t, item.messageKey, item.params, item.message);
}
