import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { SunatProvider } from "./SunatProvider.js";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function boolFrom(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toUpperCase();
  if (["TRUE", "1", "YES", "VALID", "ACCEPTED", "ACEPTADO", "ACTIVO", "HABIDO"].includes(normalized)) return true;
  if (["FALSE", "0", "NO", "INVALID", "REJECTED", "ANULADO", "BAJA", "NO_HABIDO"].includes(normalized)) return false;
  return fallback;
}

function firstValue(source, keys, fallback) {
  for (const key of keys) {
    const parts = key.split(".");
    let value = source;
    for (const part of parts) value = value?.[part];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizedEndpoint(baseUrl, endpoint) {
  if (!baseUrl || !endpoint) return "";
  return `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
}

export class ProductionSunatProvider extends SunatProvider {
  constructor() {
    const baseUrl = env("SUNAT_API_BASE_URL");
    const token = env("SUNAT_API_TOKEN");
    const taxpayerEndpoint = env("SUNAT_TAXPAYER_ENDPOINT");
    const voucherEndpoint = env("SUNAT_VOUCHER_ENDPOINT");
    const configured = Boolean(baseUrl && token && (taxpayerEndpoint || voucherEndpoint || env("SUNAT_EXCHANGE_RATE_ENDPOINT")));
    super({ mode: "PRODUCTION", configured });
    this.baseUrl = baseUrl;
    this.token = token;
    this.taxpayerEndpoint = taxpayerEndpoint;
    this.voucherEndpoint = voucherEndpoint;
    this.exchangeRateEndpoint = env("SUNAT_EXCHANGE_RATE_ENDPOINT");
    this.method = env("SUNAT_API_METHOD", "POST").toUpperCase();
    this.timeoutMs = Number(env("SUNAT_API_TIMEOUT_MS", "10000")) || 10000;
  }

  assertConfigured(capability = "validation") {
    if (!this.configured || (capability === "taxpayer-validation" && !this.taxpayerEndpoint) || (capability === "voucher-validation" && !this.voucherEndpoint)) {
      throw new AppError(
        503,
        "SUNAT production integration is not configured.",
        {
          capability,
          requiredEnvironment: ["SUNAT_API_BASE_URL", "SUNAT_API_TOKEN", "SUNAT_TAXPAYER_ENDPOINT", "SUNAT_VOUCHER_ENDPOINT"]
        },
        ERROR_CODES.INTEGRATION_NOT_CONFIGURED
      );
    }
  }

  async request(endpoint, payload) {
    this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`
    };
    let url = normalizedEndpoint(this.baseUrl, endpoint);
    const options = { method: this.method, headers, signal: controller.signal };
    if (this.method === "GET") {
      const params = new URLSearchParams(Object.entries(payload || {}).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
      if ([...params].length) url += `${url.includes("?") ? "&" : "?"}${params}`;
    } else {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload || {});
    }
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; }
      catch { data = { raw: text }; }
      if (!response.ok) {
        throw new AppError(502, "SUNAT provider returned an unsuccessful response.", { status: response.status, providerResponse: data }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
      }
      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const reason = error?.name === "AbortError" ? "SUNAT request timed out." : "SUNAT provider could not be reached.";
      throw new AppError(502, reason, { provider: "PRODUCTION" }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
    } finally {
      clearTimeout(timer);
    }
  }

  async validateTaxpayer(identifier) {
    this.assertConfigured("taxpayer-validation");
    const response = await this.request(this.taxpayerEndpoint, { ruc: String(identifier || "").replace(/\D/g, "") });
    const status = String(firstValue(response, ["status", "estado", "data.status", "data.estado"], "")).trim().toUpperCase();
    const condition = String(firstValue(response, ["condition", "condicion", "data.condition", "data.condicion"], "")).trim().toUpperCase();
    const active = boolFrom(firstValue(response, ["valid", "active", "data.valid", "data.active"], undefined), ["ACTIVO", "ACTIVE"].includes(status));
    const habido = condition ? ["HABIDO", "ACTIVE", "OK"].includes(condition) : true;
    return {
      valid: active && habido,
      source: "SUNAT_PRODUCTION",
      status,
      condition,
      taxpayerStatus: status,
      returnedIdentifier: firstValue(response, ["ruc", "identifier", "data.ruc", "data.identifier"], String(identifier || "")),
      returnedLegalName: firstValue(response, ["legalName", "razonSocial", "data.legalName", "data.razonSocial"], ""),
      raw: response
    };
  }

  async validateVoucher(voucher) {
    this.assertConfigured("voucher-validation");
    const payload = {
      ruc: voucher?.ruc || voucher?.issuerRuc,
      tipoComprobante: voucher?.voucherType || voucher?.documentType,
      serie: voucher?.series,
      numero: voucher?.number,
      fechaEmision: voucher?.issueDate,
      monto: voucher?.totalAmount
    };
    const response = await this.request(this.voucherEndpoint, payload);
    const status = String(firstValue(response, ["voucherStatus", "data.estadoCp", "estadoCp", "status", "estado", "data.status", "data.estado"], "")).trim().toUpperCase();
    const valid = boolFrom(firstValue(response, ["valid", "accepted", "data.valid", "data.accepted"], undefined), ["ACEPTADO", "ACCEPTED", "VALID", "VALIDO", "VÁLIDO"].includes(status));
    const accepted = ["1", "ACEPTADO", "ACCEPTED", "VALID", "VALIDO", "VÁLIDO"].includes(status) || firstValue(response, ["voucherVerified", "data.voucherVerified"], false) === true;
    const explicitlyUnverified = firstValue(response, ["voucherVerified", "data.voucherVerified"], undefined) === false || firstValue(response, ["publicDataset", "data.publicDataset"], false) === true;
    const verified = (valid || status === "1") && accepted && !explicitlyUnverified;
    return { valid: verified, voucherVerified: verified, source: "SUNAT_PRODUCTION", status, raw: response };
  }

  async getSellingExchangeRate({ date }) {
    if (!this.exchangeRateEndpoint) {
      throw new AppError(422, "SUNAT exchange-rate endpoint is not configured.", { date }, ERROR_CODES.EXCHANGE_RATE_MISSING);
    }
    const response = await this.request(this.exchangeRateEndpoint, { date });
    const value = Number(firstValue(response, ["sellingRate", "venta", "rate", "data.sellingRate", "data.venta", "data.rate"], 0));
    if (!(value > 0)) throw new AppError(422, "SUNAT provider did not return a valid selling exchange rate.", { date }, ERROR_CODES.EXCHANGE_RATE_MISSING);
    const publishedDate = firstValue(response, ["date", "fecha", "data.date", "data.fecha"], "");
    const source = firstValue(response, ["source", "data.source"], "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedDate) || publishedDate > date || !["SUNAT", "SUNAT_PRODUCTION"].includes(source)) throw new AppError(502, "The exchange-rate adapter must return the actual SUNAT publication date and source.");
    return { rate: value, date: publishedDate, source, sourceUrl: normalizedEndpoint(this.baseUrl, this.exchangeRateEndpoint), authoritative: true, raw: response };
  }
}
