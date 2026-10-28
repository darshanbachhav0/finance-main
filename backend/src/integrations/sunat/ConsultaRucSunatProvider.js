import { getSupplierAutomaticPrefill } from "../../services/supplierPadronLookupService.js";
import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { SunatProvider } from "./SunatProvider.js";

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const text = (value) => String(value ?? "").trim();

// SUNAT_PROVIDER_MODE=CONSULTA_RUC (the default): a RUC is verified on SUNAT's public Consulta RUC
// page - RUC, legal name, status, domicile condition and the rest of its profile. An explicitly
// enabled Padrón fallback supplies official data if the website is unavailable. mode=PRODUCTION
// is intentional, as for the Padrón: supplier
// homologation treats an official SUNAT source as authoritative. The public page cannot confirm an
// individual invoice (CPE), so a voucher is never verified here: Accounting's audited manual SUNAT
// exception remains the way an invoice posts, unless a contracted CPE endpoint is configured.
export class ConsultaRucSunatProvider extends SunatProvider {
  constructor({ lookupProfile = getSupplierAutomaticPrefill } = {}) {
    super({ mode: "PRODUCTION", configured: true });
    this.variant = "CONSULTA_RUC";
    this.source = "SUNAT_CONSULTA_RUC";
    this.lookupProfile = lookupProfile;
    this.capabilities = Object.freeze({
      taxpayerRuc: true,
      taxpayerLegalName: true,
      taxpayerStatus: true,
      domicileCondition: true,
      fiscalAddress: true,
      taxpayerProfile: true,
      voucherExistence: false,
      voucherAcceptance: false,
      exchangeRate: false
    });
  }

  async validateTaxpayer(identifier) {
    const ruc = digits(identifier);
    if (!/^\d{11}$/.test(ruc)) {
      return { valid: false, source: this.source, official: true, status: "RUC_INVALIDO", condition: "NO_VERIFICADO", returnedIdentifier: ruc, returnedLegalName: "", message: "SUNAT Consulta RUC validates 11-digit RUC values only." };
    }
    // Unavailable (timeout, access restricted, missing browser): a 503 from the lookup, never valid.
    const profile = await this.lookupProfile(ruc);
    const data = profile.data || {};
    if (profile.found !== true) {
      return { valid: false, source: profile.source || this.source, official: profile.officialSource === true, status: "NO_ENCONTRADO", condition: "NO_ENCONTRADO", returnedIdentifier: ruc, returnedLegalName: "", queriedAt: profile.queriedAt, message: profile.message || "SUNAT Consulta RUC does not recognize this RUC." };
    }
    const valid = data.active === true && data.habido === true;
    return {
      valid,
      official: profile.officialSource === true,
      source: profile.source,
      status: data.taxpayerStatus || "NO_INFORMADO",
      condition: data.domicileCondition || "NO_INFORMADO",
      taxpayerStatus: data.taxpayerStatus,
      returnedIdentifier: data.rucDni || ruc,
      returnedLegalName: data.legalName || "",
      legalName: data.legalName || "",
      fiscalAddress: data.fiscalAddress,
      ubigeo: data.location?.ubigeo,
      queriedAt: profile.queriedAt,
      datasetDate: profile.datasetDate,
      fallback: profile.fallback === true,
      cacheExpiresAt: profile.cacheExpiresAt,
      comments: `${profile.source}: ${data.taxpayerStatus || "NO_INFORMADO"} / ${data.domicileCondition || "NO_INFORMADO"}; ${profile.datasetDate || profile.queriedAt || ""}`.trim(),
      message: valid
        ? profile.source === "SUNAT_PUBLIC_PADRON_RUC" ? "RUC is ACTIVO and HABIDO in the official SUNAT Padrón." : "RUC is ACTIVO and HABIDO in SUNAT Consulta RUC."
        : `RUC is not eligible: status ${data.taxpayerStatus || "NO_INFORMADO"}, condition ${data.domicileCondition || "NO_INFORMADO"}.`
    };
  }

  async validateVoucher(voucher = {}) {
    const ruc = digits(voucher.ruc || voucher.issuerRuc || voucher.rucIssuer);
    const series = text(voucher.series).toUpperCase();
    const number = text(voucher.number).toUpperCase();
    const unverified = { valid: false, source: this.source, official: true, authoritative: false, voucherVerified: false };
    if (!series || !number) return { ...unverified, status: "DATOS_COMPROBANTE_INVALIDOS", message: "Voucher series and number are required." };
    const taxpayer = await this.validateTaxpayer(ruc);
    if (!taxpayer.valid) return { ...unverified, status: `RUC_${taxpayer.status || taxpayer.condition || "INVALIDO"}`, taxpayer, message: taxpayer.message };
    return {
      ...unverified,
      status: "COMPROBANTE_NO_VERIFICADO",
      taxpayer,
      message: "Issuer RUC is ACTIVO/HABIDO in SUNAT Consulta RUC. The public page does not confirm the existence, acceptance, cancellation, date or amount of this specific CPE."
    };
  }

  async getSellingExchangeRate({ date }) {
    throw new AppError(422, "SUNAT Consulta RUC does not provide exchange rates.", { date, provider: this.source }, ERROR_CODES.EXCHANGE_RATE_MISSING);
  }
}
