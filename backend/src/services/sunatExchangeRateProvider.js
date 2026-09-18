import { ProductionSunatProvider } from "../integrations/sunat/ProductionSunatProvider.js";
import { AppError } from "../utils/AppError.js";

export function validRateDate(value) {
  const text = String(value || "").slice(0, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return text;
}

export function rateSnapshot(rate, requestedDate, reason) {
  const date = validRateDate(rate.date instanceof Date ? rate.date.toISOString() : rate.date);
  if (!date || date > requestedDate || !(Number(rate.rate) > 0) || !Number.isFinite(Number(rate.rate))) throw new AppError(422, "Invalid selling-rate evidence.");
  const authoritative = rate.authoritative === true && ["SUNAT", "SUNAT_PRODUCTION"].includes(rate.source) && (!rate.providerMode || rate.providerMode === "SUNAT");
  return { rate: Number(rate.rate), date: new Date(`${date}T00:00:00Z`), requestedDate: new Date(`${requestedDate}T00:00:00Z`), source: rate.source,
    providerMode: rate.providerMode || "SUNAT", authoritative, sourceUrl: rate.sourceUrl,
    fallback: { used: date !== requestedDate || !authoritative, reason: reason || (date !== requestedDate ? "PREVIOUS_PUBLISHED_BUSINESS_DAY" : !authoritative ? "REFERENCE_SOURCE" : undefined), requestedDate, usedDate: date, source: rate.source }, recordId: rate._id };
}

export async function fetchSunatSellingRate(date, { provider = new ProductionSunatProvider() } = {}) {
  const result = await provider.getSellingExchangeRate({ date });
  if (result.authoritative !== true || !["SUNAT", "SUNAT_PRODUCTION"].includes(result.source)) throw new AppError(502, "The provider did not supply authoritative SUNAT selling-rate evidence.");
  return { ...result, providerMode: "SUNAT" };
}
