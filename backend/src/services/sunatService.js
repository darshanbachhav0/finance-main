import { sunatProviderMode, usesConsultaRucOnly, usesPublicPadron } from "../config/sunatMode.js";
import { ConsultaRucSunatProvider } from "../integrations/sunat/ConsultaRucSunatProvider.js";
import { ManualSunatProvider } from "../integrations/sunat/ManualSunatProvider.js";
import { MockSunatProvider } from "../integrations/sunat/MockSunatProvider.js";
import { NotConfiguredSunatProvider } from "../integrations/sunat/NotConfiguredSunatProvider.js";
import { ProductionSunatProvider } from "../integrations/sunat/ProductionSunatProvider.js";
import { PublicPadronSunatProvider } from "../integrations/sunat/PublicPadronSunatProvider.js";

// The providers that look a supplier's RUC up by themselves (no manual decision): saving a proposal,
// "Validate automatically with SUNAT" and the jefe's approval run that official check.
export const AUTOMATIC_TAXPAYER_VARIANTS = Object.freeze(["CONSULTA_RUC", "PADRON"]);
export const usesAutomaticTaxpayerLookup = (status = sunatService.status()) => AUTOMATIC_TAXPAYER_VARIANTS.includes(status.variant);

// Unset means PADRON (config/sunatMode.js); MOCK is used only when set explicitly.
export function getSunatProvider(
  mode =
    sunatProviderMode()
) {
  const normalized =
    sunatProviderMode({ SUNAT_PROVIDER_MODE: mode });

  if (
    normalized === "CONSULTA_RUC"
  ) {
    return new ConsultaRucSunatProvider();
  }

  if (
    normalized === "MOCK"
  ) {
    return new MockSunatProvider();
  }

  if (
    normalized === "MANUAL"
  ) {
    return new ManualSunatProvider();
  }

  if (
    normalized === "PADRON"
  ) {
    return new PublicPadronSunatProvider();
  }

  if (
    normalized ===
    "PRODUCTION"
  ) {
    const provider =
      new ProductionSunatProvider();

    return provider.configured
      ? provider
      : new NotConfiguredSunatProvider();
  }

  return new NotConfiguredSunatProvider();
}

export const sunatService = {
  status() {
    const provider =
      getSunatProvider();

    return {
      mode:
        provider.mode,

      configured:
        provider.configured,

      state:
        provider.configured
          ? provider.mode
          : "NOT_CONFIGURED",

      variant:
        provider.variant ||
        "",

      source:
        provider.source ||
        provider.mode,

      capabilities:
        provider.capabilities ||
        undefined
    };
  },

  validateTaxpayer(
    identifier,
    context
  ) {
    return getSunatProvider()
      .validateTaxpayer(
        identifier,
        context
      );
  },

  validateVoucher(
    voucher,
    context
  ) {
    // A contracted CPE endpoint, when configured, verifies vouchers the public sources cannot.
    if ((usesPublicPadron() || usesConsultaRucOnly()) && process.env.SUNAT_VOUCHER_ENDPOINT) {
      return new ProductionSunatProvider().validateVoucher(voucher, context);
    }
    return getSunatProvider()
      .validateVoucher(
        voucher,
        context
      );
  },

  getSellingExchangeRate(
    input,
    context
  ) {
    return getSunatProvider()
      .getSellingExchangeRate(
        input,
        context
      );
  }
};
