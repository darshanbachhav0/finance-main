import ExchangeRate from "../models/ExchangeRate.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { multiplyMoney } from "../utils/money.js";

export function startOfUtcDay(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new AppError(422, "A valid exchange-rate date is required.", { date: dateValue }, ERROR_CODES.VALIDATION_ERROR);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function resolveExchangeRateSnapshot(currency, issueDate) {
  const date = startOfUtcDay(issueDate);
  if (currency === "PEN") {
    return { rate: 1, date, source: "PEN", providerMode: "MANUAL", authoritative: true };
  }
  const record = await ExchangeRate.findOne({ currency: "USD", date });
  if (!record) {
    throw new AppError(
      422,
      `Missing applicable USD/PEN selling exchange rate for ${date.toISOString().slice(0, 10)}.`,
      { currency: "USD", date: date.toISOString().slice(0, 10) },
      ERROR_CODES.EXCHANGE_RATE_MISSING
    );
  }
  return {
    rate: record.rate,
    date: record.date,
    source: record.sourceLabel || record.source,
    providerMode: record.providerMode,
    authoritative: record.authoritative,
    recordId: record._id
  };
}

export async function applyExchangeRate(request) {
  const snapshot = await resolveExchangeRateSnapshot(request.currency, request.issueDate);
  request.exchangeRate = snapshot.rate;
  request.exchangeRateDate = snapshot.date;
  request.exchangeRateSource = snapshot.source;
  for (const line of request.lines || []) {
    line.currency = request.currency;
    line.exchangeRate = snapshot.rate;
    line.penEquivalent = multiplyMoney(line.totalAmount, snapshot.rate);
  }
  return request;
}

