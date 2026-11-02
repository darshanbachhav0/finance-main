import ExchangeRate from "../models/ExchangeRate.js";
import ExchangeRateSyncRun from "../models/ExchangeRateSyncRun.js";
import Notification from "../models/Notification.js";
import { isBusinessDay, limaToday } from "../../../shared/businessCalendar.mjs";
import { ROLES } from "../utils/constants.js";
import { recordAudit } from "./auditService.js";
import { calendarOptions } from "./businessCalendarService.js";
import { notificationText, notifyRoles } from "./notificationService.js";
import { addDays, fetchBcrpSbsRates, fetchSunatPublishedRate } from "./sbsExchangeRateProvider.js";

// Keeps the official SBS USD/PEN rates current without anyone signing in: the exchange-rate worker
// (workers/exchangeRateWorker.js) calls syncOfficialExchangeRates on start-up and every hour, and
// the resolver calls it on demand when a needed date is missing. Each source is retried; a failure
// is recorded (ExchangeRateSyncRun) and, when the latest official rate falls behind, Contabilidad,
// Tesorería and the administrators are alerted. Values are stored exactly as published.
export const SYNC_LOOKBACK_DAYS = 15;
const RETRY_DELAYS_MS = [2000, 8000];
const STALE_EVENT_PREFIX = "exchange-rate:stale:";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries(source, work, { retries = RETRY_DELAYS_MS.length, delays = RETRY_DELAYS_MS, wait = sleep } = {}) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      return { source, attempts, rates: await work() };
    } catch (error) {
      if (attempts > retries) return { source, attempts, rates: [], error: String(error?.message || error).slice(0, 300) };
      await wait(delays[Math.min(attempts - 1, delays.length - 1)]);
    }
  }
}

// The effective date the newest official rate must reach: the day after the last business day
// before today (the SBS closes on business days; SUNAT publishes that close the next day and
// repeats it over weekends and holidays).
export function expectedLatestEffectiveDate(today, options = calendarOptions()) {
  let day = addDays(today, -1);
  while (!isBusinessDay(new Date(`${day}T17:00:00Z`), options)) day = addDays(day, -1);
  return addDays(day, 1);
}

export async function latestOfficialRate(currency = "USD") {
  return ExchangeRate.findOne({ currency, providerMode: "SBS", authoritative: true, active: true }).sort({ date: -1 }).lean();
}

// Merge both sources by applicable date. SUNAT's published table wins on a disagreement (it is the
// table the tax rules point to) and the disagreement is reported.
function mergeRates(results) {
  const byDate = new Map();
  const disagreements = [];
  for (const result of results) {
    for (const rate of result.rates) {
      const current = byDate.get(rate.date);
      if (!current) { byDate.set(rate.date, { ...rate, confirmedBy: [rate.source] }); continue; }
      if (current.buyRate === rate.buyRate && current.sellRate === rate.sellRate) {
        current.confirmedBy = [...new Set([...current.confirmedBy, rate.source])];
        current.sbsClosingDate ||= rate.sbsClosingDate;
        continue;
      }
      disagreements.push({ date: rate.date, [current.source]: [current.buyRate, current.sellRate], [rate.source]: [rate.buyRate, rate.sellRate] });
      if (rate.source === "SUNAT_SBS") byDate.set(rate.date, { ...rate, sbsClosingDate: current.sbsClosingDate, confirmedBy: [rate.source] });
    }
  }
  return { rates: [...byDate.values()], disagreements };
}

async function storeRate(rate, now) {
  const date = new Date(`${rate.date}T00:00:00Z`);
  const values = {
    currency: "USD",
    quoteCurrency: "PEN",
    date,
    period: rate.date.slice(0, 7),
    rate: rate.sellRate,
    buyRate: rate.buyRate,
    sellRate: rate.sellRate,
    sbsClosingDate: rate.sbsClosingDate ? new Date(`${rate.sbsClosingDate}T00:00:00Z`) : undefined,
    source: rate.source,
    sourceLabel: rate.sourceLabel,
    providerMode: "SBS",
    authoritative: true,
    sourceUrl: rate.sourceUrl,
    retrievedAt: now,
    confirmedBy: rate.confirmedBy,
    active: true
  };
  const existing = await ExchangeRate.findOne({ currency: "USD", date }).lean();
  if (!existing) {
    await ExchangeRate.create(values);
    return "inserted";
  }
  const sameValue = existing.providerMode === "SBS" && existing.buyRate === rate.buyRate && existing.sellRate === rate.sellRate;
  if (sameValue) {
    const confirmedBy = [...new Set([...(existing.confirmedBy || []), ...rate.confirmedBy])];
    if (confirmedBy.length !== (existing.confirmedBy || []).length) await ExchangeRate.updateOne({ _id: existing._id }, { $set: { confirmedBy } });
    return "unchanged";
  }
  // A manual entry gives way to the official value; an official value that changed is a
  // correction by the source. Both are audited with what was there before.
  await ExchangeRate.updateOne({ _id: existing._id }, { $set: values });
  await recordAudit({
    entityType: "ExchangeRate", entity: existing._id, action: existing.providerMode === "SBS" ? "OFFICIAL_RATE_CORRECTED" : "MANUAL_RATE_REPLACED_BY_OFFICIAL",
    module: "EXCHANGE_RATES", message: `USD/PEN ${rate.date}: official SBS rate stored from ${rate.source}.`,
    oldValues: { rate: existing.rate, buyRate: existing.buyRate, sellRate: existing.sellRate, source: existing.source, providerMode: existing.providerMode },
    newValues: { buyRate: rate.buyRate, sellRate: rate.sellRate, source: rate.source }
  });
  return "updated";
}

async function alertIfStale({ today, latestDate }) {
  const expected = expectedLatestEffectiveDate(today);
  const stale = !latestDate || latestDate < expected;
  if (!stale) {
    await Notification.updateMany({ eventKey: { $regex: `^${STALE_EVENT_PREFIX}` }, resolvedAt: null }, { $set: { resolvedAt: new Date() } });
    return false;
  }
  await notifyRoles({
    once: true,
    roles: [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.ADMIN],
    eventKey: `${STALE_EVENT_PREFIX}${today}`,
    type: "EXCHANGE_RATE_STALE",
    title: notificationText("Official exchange rate is out of date"),
    message: latestDate
      ? notificationText("The latest official SBS USD/PEN rate stored is for {date}; the rate for {expected} could not be retrieved. Foreign-currency postings wait until it is.", { date: latestDate, expected })
      : notificationText("No official SBS USD/PEN rate is stored yet. Foreign-currency postings wait until one is retrieved."),
    path: "/exchange-rates",
    entityType: "ExchangeRate"
  });
  return true;
}

// trigger: SCHEDULE | STARTUP | MANUAL | ON_DEMAND. sources: injectable fetchers for tests.
export async function syncOfficialExchangeRates({
  trigger = "SCHEDULE",
  now = new Date(),
  lookbackDays = SYNC_LOOKBACK_DAYS,
  fetchImpl,
  requestedBy,
  retry = {},
  sources = {
    SUNAT_SBS: () => fetchSunatPublishedRate({ fetchImpl }).then((rate) => [{ ...rate, date: rate.effectiveDate }]),
    BCRP_SBS: ({ from, to }) => fetchBcrpSbsRates({ from, to, fetchImpl })
  }
} = {}) {
  const today = limaToday(now);
  const from = addDays(today, -lookbackDays);
  const results = await Promise.all(Object.entries(sources).map(([source, fetch]) => withRetries(source, () => fetch({ from, to: today }), retry)));
  const { rates, disagreements } = mergeRates(results);
  let inserted = 0;
  let updated = 0;
  for (const rate of rates) {
    const outcome = await storeRate(rate, now);
    if (outcome === "inserted") inserted += 1;
    if (outcome === "updated") updated += 1;
  }
  const latest = await latestOfficialRate();
  const latestDate = latest ? latest.date.toISOString().slice(0, 10) : null;
  const stale = await alertIfStale({ today, latestDate });
  const failed = results.filter((result) => result.error);
  const status = failed.length === results.length ? "FAILED" : failed.length ? "PARTIAL" : "OK";
  const run = await ExchangeRateSyncRun.create({
    trigger,
    startedAt: now,
    finishedAt: new Date(),
    status,
    sources: results.map((result) => ({
      source: result.source,
      status: result.error ? "FAILED" : "OK",
      attempts: result.attempts,
      received: result.rates.length,
      latestDate: result.rates.map((rate) => rate.date).sort().at(-1),
      error: result.error
    })),
    inserted,
    updated,
    latestDate,
    stale,
    requestedBy
  });
  for (const result of failed) console.error(`[EXCHANGE RATES] ${result.source} failed after ${result.attempts} attempt(s): ${result.error}`);
  if (disagreements.length) console.error("[EXCHANGE RATES] Sources disagree; SUNAT's published table was kept:", JSON.stringify(disagreements));
  return { run: run.toObject(), inserted, updated, latestDate, stale, disagreements };
}

export async function lastSyncRun() {
  return ExchangeRateSyncRun.findOne().sort({ startedAt: -1 }).lean();
}
