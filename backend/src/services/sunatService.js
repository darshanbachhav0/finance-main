import { ManualSunatProvider } from "../integrations/sunat/ManualSunatProvider.js";
import { MockSunatProvider } from "../integrations/sunat/MockSunatProvider.js";
import { NotConfiguredSunatProvider } from "../integrations/sunat/NotConfiguredSunatProvider.js";
import { ProductionSunatProvider } from "../integrations/sunat/ProductionSunatProvider.js";
import { PublicPadronSunatProvider } from "../integrations/sunat/PublicPadronSunatProvider.js";

export function getSunatProvider(
  mode =
    process.env
      .SUNAT_PROVIDER_MODE ||
    (
      process.env.NODE_ENV ===
      "production"
        ? "PRODUCTION"
        : "MOCK"
    )
) {
  const normalized =
    String(
      mode || ""
    )
      .trim()
      .toUpperCase();

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
    [
      "PADRON",
      "PUBLIC_PADRON",
      "PUBLIC-PADRON"
    ].includes(normalized)
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