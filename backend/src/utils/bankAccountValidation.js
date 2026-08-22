import { AppError } from "./AppError.js";
import { ERROR_CODES } from "./constants.js";

const PERMITTED_FORMATTING = /[\s-]/g;

function normalizeDigits(value, field) {
  const original = String(value ?? "").trim();
  if (!original) return "";
  const normalized = original.replace(PERMITTED_FORMATTING, "");
  if (!/^\d+$/.test(normalized)) {
    throw new AppError(
      422,
      `${field} must contain digits only; spaces and hyphens are accepted as formatting.`,
      { field, value },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return normalized;
}

export function normalizeBankAccountNumber(value) {
  return normalizeDigits(value, "accountNumber");
}

export function normalizeCci(value) {
  return normalizeDigits(value, "cci");
}

export function assertValidBankAccountNumber(value, { required = true } = {}) {
  const normalized = normalizeBankAccountNumber(value);
  if (required && !normalized) {
    throw new AppError(422, "Bank account number is required.", { field: "accountNumber" }, ERROR_CODES.VALIDATION_ERROR);
  }
  return normalized;
}

export function assertValidCci(value, { required = true } = {}) {
  const normalized = normalizeCci(value);
  if (required && !normalized) {
    throw new AppError(422, "CCI is required.", { field: "cci" }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (normalized && normalized.length !== 20) {
    throw new AppError(
      422,
      "CCI must contain exactly 20 digits.",
      { field: "cci", length: normalized.length },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return normalized;
}
