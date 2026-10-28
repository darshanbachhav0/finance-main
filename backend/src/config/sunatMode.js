// Which SUNAT source the platform uses (SUNAT_PROVIDER_MODE). CONSULTA_RUC, the default, verifies a
// RUC on SUNAT's public Consulta RUC page. An official Padrón fallback needs explicit opt-in.
// PADRON (the downloaded national RUC file), PRODUCTION
// (a contracted CPE API), MANUAL and MOCK (offline, for the automated tests and the demo seed) are
// used only when configured explicitly.
const ALIASES = Object.freeze({
  CONSULTA_RUC: "CONSULTA_RUC",
  "CONSULTA-RUC": "CONSULTA_RUC",
  CONSULTARUC: "CONSULTA_RUC",
  PADRON: "PADRON",
  PUBLIC_PADRON: "PADRON",
  "PUBLIC-PADRON": "PADRON"
});

export const DEFAULT_SUNAT_PROVIDER_MODE = "CONSULTA_RUC";

export function sunatProviderMode(env = process.env) {
  const mode = String(env.SUNAT_PROVIDER_MODE || "").trim().toUpperCase();
  if (!mode) return DEFAULT_SUNAT_PROVIDER_MODE;
  return ALIASES[mode] || mode;
}

export const usesPublicPadron = (env = process.env) => sunatProviderMode(env) === "PADRON";
export const usesPadronFallback = (env = process.env) => sunatProviderMode(env) === "CONSULTA_RUC"
  && ["true", "1", "yes", "on"].includes(String(env.SUNAT_CONSULTA_RUC_PADRON_FALLBACK || "").trim().toLowerCase());
export const usesConsultaRucOnly = (env = process.env) => sunatProviderMode(env) === "CONSULTA_RUC" && !usesPadronFallback(env);
export const usesPublicPadronData = (env = process.env) => usesPublicPadron(env) || usesPadronFallback(env);
