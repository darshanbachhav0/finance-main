// The SUNAT sources that verify a supplier's RUC by themselves, as the server reports them
// (backend sunatService.AUTOMATIC_TAXPAYER_VARIANTS): SUNAT Consulta RUC, the default, or the
// downloaded public Padrón. Neither verifies an individual invoice.
export const AUTOMATIC_TAXPAYER_VARIANTS = Object.freeze(["CONSULTA_RUC", "PADRON"]);

export const automaticTaxpayerLookup = (provider) => AUTOMATIC_TAXPAYER_VARIANTS.includes(provider?.variant);
