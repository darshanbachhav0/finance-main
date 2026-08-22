import { AppError } from "./AppError.js";
import { ERROR_CODES } from "./constants.js";

export const MONEY_SCALE = 2;
export const MONEY_FACTOR = 10 ** MONEY_SCALE;

export function toMinorUnits(value) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new AppError(422, "Invalid monetary value.", { value }, ERROR_CODES.VALIDATION_ERROR);
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = `${fraction}00`;
  const roundingDigit = Number(padded[MONEY_SCALE] || 0);
  let minor = BigInt(whole || "0") * BigInt(MONEY_FACTOR) + BigInt(padded.slice(0, MONEY_SCALE));
  if (roundingDigit >= 5) minor += 1n;
  return Number(negative ? -minor : minor);
}

export function fromMinorUnits(value) {
  return Number((Number(value || 0) / MONEY_FACTOR).toFixed(MONEY_SCALE));
}

export function roundMoney(value) {
  return fromMinorUnits(toMinorUnits(value));
}

export function addMoney(...values) {
  return fromMinorUnits(values.reduce((sum, value) => sum + toMinorUnits(value), 0));
}

export function subtractMoney(left, right) {
  return fromMinorUnits(toMinorUnits(left) - toMinorUnits(right));
}

export function multiplyMoney(value, factor) {
  const factorText = String(factor ?? 0);
  if (!/^-?\d+(\.\d+)?$/.test(factorText)) {
    throw new AppError(422, "Invalid monetary multiplier.", { factor }, ERROR_CODES.VALIDATION_ERROR);
  }
  const factorScale = Math.min(8, (factorText.split(".")[1] || "").length);
  const factorUnits = BigInt(Math.round(Number(factorText) * 10 ** factorScale));
  const numerator = BigInt(toMinorUnits(value)) * factorUnits;
  const divisor = BigInt(10 ** factorScale);
  const rounded = (numerator + (numerator >= 0n ? divisor / 2n : -(divisor / 2n))) / divisor;
  return fromMinorUnits(Number(rounded));
}

export function sumMoney(values) {
  return fromMinorUnits((values || []).reduce((sum, value) => sum + toMinorUnits(value), 0));
}

export function moneyEquals(left, right) {
  return toMinorUnits(left) === toMinorUnits(right);
}

export function assertLineTotal(line, index = 0) {
  const expected = addMoney(line.netAmount ?? line.net, line.igvAmount ?? line.igv);
  const actual = roundMoney(line.totalAmount ?? line.total);
  if (!moneyEquals(expected, actual)) {
    throw new AppError(
      422,
      `Line ${index + 1} total must equal Net plus IGV.`,
      { index, expected, actual },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
}

