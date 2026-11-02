import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { parseBcrpDate } from "./exchangeRateProvider.js";

// Official USD/PEN rates of the Peruvian banking system as published by the SBS, read from two
// authorized public sources. Nothing here invents, rounds or substitutes a value: a source that
// does not answer with a well-formed publication is a failure, reported as such.
//
// - SUNAT "tipo de cambio" (https://www.sunat.gob.pe/a/txt/tipoCambio.txt): "dd/mm/yyyy|compra|venta|".
//   It is the SBS rate SUNAT publishes for that date (the SBS close of the previous business
//   day), the table Peruvian accounting uses for a document's date.
// - BCRPData, the SBS banking-system series PD04639PD (compra) and PD04640PD (venta). Each value
//   is dated with the SBS close it belongs to; it applies from the next day on, which is how
//   SUNAT publishes it.
export const SUNAT_RATE_URL = "https://www.sunat.gob.pe/a/txt/tipoCambio.txt";
export const BCRP_SBS_SERIES = Object.freeze({ buy: "PD04639PD", sell: "PD04640PD" });
export const BCRP_API = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";

const RATE_PATTERN = /^\d{1,2}(\.\d{1,6})?$/;

function sourceError(message, details) {
  return new AppError(502, message, details, ERROR_CODES.EXCHANGE_RATE_MISSING);
}

// A rate as published: a positive decimal string with up to six decimals, kept as text until it
// is stored, so no binary rounding happens on the way in.
export function publishedRate(value) {
  const text = String(value ?? "").trim();
  if (!RATE_PATTERN.test(text)) return null;
  const rate = Number(text);
  return rate > 0 && rate < 100 ? rate : null;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Bot-protection or error pages come back as HTML with status 200: never read them as data.
function looksLikeHtml(text, contentType) {
  return /text\/html/i.test(String(contentType || "")) || /^\s*<(!doctype|html)/i.test(text);
}

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, init = {} } = {}) {
  if (typeof fetchImpl !== "function") throw sourceError("This server cannot reach the exchange-rate sources.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw sourceError(`The source answered with status ${response.status}.`, { url, status: response.status });
    return { text, contentType: response.headers?.get?.("content-type") || "" };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.name === "AbortError") throw sourceError("The exchange-rate source did not answer in time.", { url });
    throw sourceError("The exchange-rate source could not be reached.", { url, reason: String(error?.message || error).slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
}

// "02/11/2026|3.458|3.467|" -> { date: "2026-11-02", buyRate, sellRate }.
export function parseSunatRateText(text) {
  const match = /^\s*(\d{2})\/(\d{2})\/(\d{4})\|([^|]+)\|([^|]+)\|?\s*$/.exec(String(text || ""));
  if (!match) throw sourceError("SUNAT did not return a published exchange rate.", { body: String(text || "").slice(0, 120) });
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  const check = new Date(`${date}T00:00:00Z`);
  const buyRate = publishedRate(match[4]);
  const sellRate = publishedRate(match[5]);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date || !buyRate || !sellRate || buyRate > sellRate) {
    throw sourceError("SUNAT returned an exchange rate that is not well formed.", { body: String(text).slice(0, 120) });
  }
  return { date, buyRate, sellRate };
}

export async function fetchSunatPublishedRate(options = {}) {
  const { text, contentType } = await fetchText(SUNAT_RATE_URL, { ...options, init: { headers: { Accept: "text/plain" } } });
  if (looksLikeHtml(text, contentType)) throw sourceError("SUNAT answered with a web page instead of the exchange-rate file.", { url: SUNAT_RATE_URL });
  const rate = parseSunatRateText(text);
  return {
    ...rate,
    // SUNAT's date is the date the rate applies to.
    effectiveDate: rate.date,
    sbsClosingDate: null,
    source: "SUNAT_SBS",
    sourceLabel: "SBS, published by SUNAT",
    sourceUrl: SUNAT_RATE_URL
  };
}

// BCRPData JSON: { config, periods: [{ name: "30.Oct.26", values: ["3.458", "3.467"] }] }; days
// without a publication carry "n.d.".
export function parseBcrpSbsSeries(payload) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : null;
  if (!periods) throw sourceError("BCRPData did not return the SBS exchange-rate series.");
  const out = [];
  for (const period of periods) {
    const closing = parseBcrpDate(period?.name);
    const buyRate = publishedRate(period?.values?.[0]);
    const sellRate = publishedRate(period?.values?.[1]);
    if (!closing || !buyRate || !sellRate || buyRate > sellRate) continue;
    out.push({ sbsClosingDate: closing, effectiveDate: addDays(closing, 1), buyRate, sellRate });
  }
  return out.sort((left, right) => left.sbsClosingDate.localeCompare(right.sbsClosingDate));
}

export function bcrpSbsUrl(from, to) {
  return `${BCRP_API}/${BCRP_SBS_SERIES.buy}-${BCRP_SBS_SERIES.sell}/json/${from}/${to}`;
}

export async function fetchBcrpSbsRates({ from, to, ...options }) {
  const url = bcrpSbsUrl(from, to);
  const { text, contentType } = await fetchText(url, { ...options, init: { headers: { Accept: "application/json" } } });
  if (looksLikeHtml(text, contentType)) {
    throw sourceError("BCRPData answered with a web page (bot protection) instead of the SBS series. Ask BCRP to allow this server, or rely on the SUNAT publication.", { url });
  }
  let payload;
  try { payload = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw sourceError("BCRPData returned an unreadable SBS series.", { url }); }
  return parseBcrpSbsSeries(payload).map((rate) => ({
    ...rate,
    date: rate.effectiveDate,
    source: "BCRP_SBS",
    sourceLabel: `SBS, BCRPData series ${BCRP_SBS_SERIES.buy}/${BCRP_SBS_SERIES.sell}`,
    sourceUrl: url
  }));
}
