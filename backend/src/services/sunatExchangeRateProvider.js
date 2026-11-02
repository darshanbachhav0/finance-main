import { ProductionSunatProvider } from "../integrations/sunat/ProductionSunatProvider.js";
import { AppError } from "../utils/AppError.js";

export function validRateDate(value) {
  const text = String(value || "").slice(0, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return text;
}

// Official sources: the SBS publications (read through SUNAT or BCRPData) and the SUNAT adapter.
const OFFICIAL_SOURCES = Object.freeze({ SBS: ["SUNAT_SBS", "BCRP_SBS"], SUNAT: ["SUNAT", "SUNAT_PRODUCTION"] });

// The evidence a transaction keeps of the rate it used: value, side (venta/compra), the date the
// rate applies to and the requested document date, its source and whether it is official.
export function rateSnapshot(rate, requestedDate, reason, side = "SELL") {
  const date = validRateDate(rate.date instanceof Date ? rate.date.toISOString() : rate.date);
  const sellRate = Number(rate.sellRate ?? rate.rate);
  const buyRate = rate.buyRate === undefined || rate.buyRate === null ? undefined : Number(rate.buyRate);
  const value = side === "BUY" ? buyRate : sellRate;
  if (!date || date > requestedDate || !(value > 0) || !Number.isFinite(value)) throw new AppError(422, "Invalid exchange-rate evidence.");
  const mode = rate.providerMode || "SUNAT";
  const authoritative = rate.authoritative === true && (OFFICIAL_SOURCES[mode] || []).includes(rate.source);
  const usedReason = reason || (date !== requestedDate ? "PREVIOUS_PUBLISHED_RATE" : !authoritative ? "REFERENCE_SOURCE" : undefined);
  return { rate: value, side, buyRate, sellRate, date: new Date(`${date}T00:00:00Z`), requestedDate: new Date(`${requestedDate}T00:00:00Z`), source: rate.source,
    sourceLabel: rate.sourceLabel, providerMode: mode, authoritative, sourceUrl: rate.sourceUrl,
    sbsClosingDate: rate.sbsClosingDate ? new Date(rate.sbsClosingDate) : undefined, retrievedAt: rate.retrievedAt,
    fallback: { used: date !== requestedDate || !authoritative, reason: usedReason, requestedDate, usedDate: date, source: rate.source }, recordId: rate._id };
}

export async function fetchSunatSellingRate(date, { provider = new ProductionSunatProvider() } = {}) {
  const result = await provider.getSellingExchangeRate({ date });
  if (result.authoritative !== true || !["SUNAT", "SUNAT_PRODUCTION"].includes(result.source)) throw new AppError(502, "The provider did not supply authoritative SUNAT selling-rate evidence.");
  return { ...result, providerMode: "SUNAT" };
}
