import ExchangeRate from "../models/ExchangeRate.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { multiplyMoney } from "../utils/money.js";
import { fetchSunatSellingRate, rateSnapshot } from "./sunatExchangeRateProvider.js";

export function startOfUtcDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(422, "A valid exchange-rate date is required.", { date: value }, ERROR_CODES.VALIDATION_ERROR);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function resolveExchangeRateSnapshot(currency, issueDate, { lookup, fetchRate = fetchSunatSellingRate, allowReference = process.env.EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK === "true" } = {}) {
  const date = startOfUtcDay(issueDate);
  const requested = date.toISOString().slice(0, 10);
  if (currency === "PEN") return { rate: 1, date, requestedDate: date, source: "PEN", providerMode: "PEN", authoritative: true, fallback: { used: false } };
  if (currency !== "USD") throw new AppError(422, "Unsupported transaction currency.");
  const read = lookup || (day => ExchangeRate.findOne({ currency: "USD", date: day, active: true }).lean());
  let reference;
  let unavailable = false;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(date); day.setUTCDate(day.getUTCDate() - offset);
    if (offset > 0 && [0, 6].includes(day.getUTCDay())) continue;
    const saved = await read(day);
    if (saved?.authoritative === true && saved.providerMode === "SUNAT" && ["SUNAT", "SUNAT_PRODUCTION"].includes(saved.source)) return rateSnapshot(saved, requested, unavailable ? "SUNAT_UNAVAILABLE_PREVIOUS_PUBLISHED_DAY" : undefined);
    if (!reference && saved?.rate > 0) reference = saved;
    try {
      const live = await fetchRate(day.toISOString().slice(0, 10));
      const snapshot = rateSnapshot(live, requested, offset ? "PREVIOUS_PUBLISHED_BUSINESS_DAY" : undefined);
      const age = (date - snapshot.date) / 86400000;
      if (!snapshot.authoritative || age > 7 || (age > 0 && [0, 6].includes(snapshot.date.getUTCDay()))) throw new Error("Invalid fallback publication date");
      return snapshot;
    } catch { unavailable = true; }
  }
  if (allowReference && reference) return rateSnapshot(reference, requested, "SUNAT_UNAVAILABLE_REFERENCE_FALLBACK");
  throw new AppError(422, `No authoritative SUNAT selling rate is available for ${requested} or the preceding seven days.`, { date: requested, requiresConfiguration: "SUNAT_EXCHANGE_RATE_ENDPOINT", referenceFallbackEnabled: allowReference }, ERROR_CODES.EXCHANGE_RATE_MISSING);
}

export async function applyExchangeRate(request) {
  // Keep historical evidence unchanged, including manual and BCRP snapshots.
  const frozen = request.accountsPayable || request.budgetCommitment || ["COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "CERRADO", "PAGADO_CERRADO", "ANULADO", "RECHAZADO"].includes(request.status);
  if (!request.isNew && frozen && request.exchangeRateDate && request.exchangeRateSource) return request;
  const snapshot = await resolveExchangeRateSnapshot(request.currency, request.issueDate);
  request.exchangeRate = snapshot.rate;
  request.exchangeRateDate = snapshot.date;
  request.exchangeRateSource = snapshot.source;
  request.exchangeRateEvidence = snapshot;
  for (const line of request.lines || []) {
    line.currency = request.currency;
    line.exchangeRate = snapshot.rate;
    line.penEquivalent = multiplyMoney(line.totalAmount, snapshot.rate);
  }
  return request;
}
