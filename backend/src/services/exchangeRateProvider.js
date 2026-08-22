import { AppError } from "../utils/AppError.js";

export const BCRP_SELLING_RATE_URL =
  "https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD/json";

const monthNumbers = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  set: "09",
  oct: "10",
  nov: "11",
  dic: "12"
};

export function parseBcrpDate(value) {
  const match = /^(\d{2})\.([A-Za-z]{3})\.(\d{2}|\d{4})$/.exec(String(value || "").trim());
  if (!match) return null;

  const month = monthNumbers[match[2].toLowerCase()];
  if (!month) return null;

  const yearValue = Number(match[3]);
  const year = match[3].length === 2 ? 2000 + yearValue : yearValue;
  return `${year}-${month}-${match[1]}`;
}

export function selectLatestSellingRate(payload) {
  const periods = Array.isArray(payload?.periods) ? payload.periods : [];
  const candidates = periods
    .map((period) => ({
      date: parseBcrpDate(period?.name),
      rate: Number(period?.values?.[0])
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.rate) && entry.rate > 0)
    .sort((left, right) => right.date.localeCompare(left.date));

  if (!candidates.length) {
    throw new AppError(502, "BCRPData did not return a published USD/PEN selling rate.");
  }

  return candidates[0];
}

export function parseBcrpPayload(value) {
  const text = String(value || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (start === -1) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          throw new AppError(502, "BCRPData returned an invalid exchange-rate response.");
        }
      }
    }
  }

  throw new AppError(502, "BCRPData returned an invalid exchange-rate response.");
}

export async function fetchLatestUsdPenSellingRate({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new AppError(503, "Online exchange-rate lookup is unavailable on this server.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(BCRP_SELLING_RATE_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AppError(502, `BCRPData exchange-rate request failed with status ${response.status}.`);
    }

    const latest = selectLatestSellingRate(parseBcrpPayload(await response.text()));
    return {
      baseCurrency: "USD",
      quoteCurrency: "PEN",
      date: latest.date,
      period: latest.date.slice(0, 7),
      rate: latest.rate,
      source: "BCRPData - SBS banking system selling rate (online)",
      sourceUrl: BCRP_SELLING_RATE_URL,
      retrievedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.name === "AbortError") {
      throw new AppError(504, "BCRPData exchange-rate request timed out. Try again.");
    }
    throw new AppError(502, "Could not retrieve the online USD/PEN exchange rate. Try again.");
  } finally {
    clearTimeout(timeout);
  }
}
