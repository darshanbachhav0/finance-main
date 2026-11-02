import ExchangeRate from "../models/ExchangeRate.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { multiplyMoney } from "../utils/money.js";
import { addDays } from "./sbsExchangeRateProvider.js";
import { expectedLatestEffectiveDate, syncOfficialExchangeRates } from "./exchangeRateSyncService.js";
import { rateSnapshot } from "./sunatExchangeRateProvider.js";

// How far back a document date looks for its rate (the official rate of a date is always the SBS
// close of the last business day before it, so a long holiday is still covered).
export const RATE_LOOKBACK_DAYS = 10;
// Official rates: the SBS publications stored by the synchronization, and authoritative SUNAT
// adapter records kept from earlier versions.
const OFFICIAL_MODES = Object.freeze(["SBS", "SUNAT"]);
const REFERENCE_MODES = Object.freeze(["MANUAL", "BCRP_FALLBACK"]);
// Fictional rates earlier development seeds stored in SUNAT's record shape: never used, and
// deactivated by scripts/migrateExchangeRateFoundation.js.
export const FICTIONAL_RATE_LABEL = /^DEMO -/;
const ON_DEMAND_INTERVAL_MS = 10 * 60 * 1000;
let lastOnDemandSync = 0;

export function startOfUtcDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(422, "A valid exchange-rate date is required.", { date: value }, ERROR_CODES.VALIDATION_ERROR);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

function latestIn(modes, { requireAuthoritative }) {
  return (day, oldest) => ExchangeRate.findOne({
    currency: "USD",
    active: true,
    providerMode: { $in: modes },
    ...(requireAuthoritative ? { authoritative: true } : {}),
    sourceLabel: { $not: FICTIONAL_RATE_LABEL },
    date: { $lte: day, $gte: oldest }
  }).sort({ date: -1 }).lean();
}

// The automatic synchronization normally has the rate already; a date that should be published but
// is not stored yet (the worker was asleep, a source was down) is fetched once, then re-read. At
// most one on-demand fetch every ten minutes, and never when EXCHANGE_RATE_ONLINE=false (tests).
async function syncOnDemand(now) {
  if (process.env.EXCHANGE_RATE_ONLINE === "false" || Date.now() - lastOnDemandSync < ON_DEMAND_INTERVAL_MS) return;
  lastOnDemandSync = Date.now();
  try { await syncOfficialExchangeRates({ trigger: "ON_DEMAND", now, retry: { retries: 0 } }); }
  catch (error) { console.error("[EXCHANGE RATES] On-demand synchronization failed", error?.message || error); }
}

// The USD/PEN rate for a document date (Manual técnico: tipo de cambio venta SBS de la fecha del
// comprobante; a date without its own publication uses the latest published before it, and says
// which). side: SELL (venta, default: what UMA owes) or BUY (compra).
export async function resolveExchangeRateSnapshot(currency, issueDate, {
  side = "SELL",
  now = new Date(),
  find = latestIn(OFFICIAL_MODES, { requireAuthoritative: true }),
  findReference = latestIn(REFERENCE_MODES, { requireAuthoritative: false }),
  syncNow = syncOnDemand,
  allowReference = process.env.EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK === "true"
} = {}) {
  const date = startOfUtcDay(issueDate);
  const requested = isoDay(date);
  if (currency === "PEN") return { rate: 1, date, requestedDate: date, source: "PEN", providerMode: "PEN", authoritative: true, fallback: { used: false } };
  if (currency !== "USD") throw new AppError(422, "Unsupported transaction currency.", { currency }, ERROR_CODES.VALIDATION_ERROR);
  const oldest = new Date(`${addDays(requested, -RATE_LOOKBACK_DAYS)}T00:00:00Z`);
  // The publication this date needs: the close of the last business day before it.
  const expected = expectedLatestEffectiveDate(requested);
  let official = await find(date, oldest);
  if (!official || isoDay(official.date) < expected) {
    await syncNow(now);
    official = await find(date, oldest);
  }
  if (official && isoDay(official.date) >= expected) return rateSnapshot(official, requested, undefined, side);
  if (allowReference) {
    const reference = await findReference(date, oldest);
    if (reference && isoDay(reference.date) >= expected) return rateSnapshot(reference, requested, "OFFICIAL_RATE_UNAVAILABLE_MANUAL_ENTRY", side);
  }
  throw new AppError(422, `No official SBS USD/PEN rate is stored for ${requested}. It is retrieved automatically; if the sources are down, Contabilidad or Tesorería is alerted.`, {
    date: requested,
    expectedPublication: expected,
    latestStored: official ? isoDay(official.date) : null,
    referenceFallbackEnabled: allowReference
  }, ERROR_CODES.EXCHANGE_RATE_MISSING);
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
