// Field-level checks used while the user fills a form (on blur). Messages are English keys
// translated with t(); submit-time validation stays in each form.

const digits = (value) => String(value ?? "").replace(/\D/g, "");

/** SUNAT RUC: 11 digits, a valid taxpayer prefix and the modulo-11 check digit. */
export function isValidRuc(value) {
  const ruc = digits(value);
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(ruc[index]), 0);
  return (11 - (sum % 11)) % 10 === Number(ruc[10]);
}

export function isValidDni(value) {
  return /^\d{8}$/.test(String(value ?? "").trim());
}

export function requiredError(value, message = "This field is required.") {
  return String(value ?? "").trim() ? "" : message;
}

/** RUC (11 digits + check digit) or DNI (8 digits), as accepted by the supplier proposal. */
export function identifierError(value, { required = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "This field is required." : "";
  if (/[^\d\s-]/.test(raw)) return "Use digits only: 11 for a RUC or 8 for a DNI.";
  const clean = digits(raw);
  if (clean.length === 8) return "";
  if (clean.length === 11) return isValidRuc(clean) ? "" : "This RUC is not valid: check the digits (the last one is a check digit).";
  return "Enter a valid 11-digit RUC or supported 8-digit DNI.";
}

export function rucError(value, { required = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "This field is required." : "";
  const clean = digits(raw);
  if (clean.length !== 11 || /[^\d\s-]/.test(raw)) return "A RUC has 11 digits.";
  return isValidRuc(clean) ? "" : "This RUC is not valid: check the digits (the last one is a check digit).";
}

export function dniError(value, { required = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "This field is required." : "";
  return isValidDni(raw) ? "" : "A DNI has 8 digits.";
}

/** Amounts must be numbers greater than zero; empty is only an error when required. */
export function positiveAmountError(value, { required = true, message = "Enter an amount greater than zero." } = {}) {
  if (value === "" || value === null || value === undefined) return required ? message : "";
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? "" : message;
}

/**
 * The month of `isoDate` (or a "YYYY-MM" key) must be an OPEN accounting period. Returns
 * "" while the period list is not loaded, so nothing is flagged before the data arrives.
 */
export function openPeriodError(isoDate, periods, message = "The date must fall within an open accounting period.") {
  if (!isoDate || !Array.isArray(periods) || !periods.length) return "";
  const key = String(isoDate).slice(0, 7);
  const period = periods.find((item) => item.period === key);
  return period && period.status === "OPEN" ? "" : message;
}
