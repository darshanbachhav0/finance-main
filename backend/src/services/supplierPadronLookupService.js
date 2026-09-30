import { lookupSunatTaxpayerProfile } from "./sunatConsultaRucRepresentativesService.js";
import { lookupSunatPadronRuc } from "./sunatPadronService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

function normalizeRuc(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function inferPersonType(ruc) {
  if (/^10\d{9}$/.test(ruc)) {
    return "NATURAL_PERSON_WITH_BUSINESS";
  }

  if (/^20\d{9}$/.test(ruc)) {
    return "LEGAL_ENTITY";
  }

  return "";
}

function datasetMeta(manifest = {}) {
  return {
    datasetDate: manifest.datasetDate || "",
    generatedAt: manifest.generatedAt || "",
    lastCheckedAt: manifest.lastCheckedAt || ""
  };
}

export async function getSupplierPadronPrefill(rucValue) {
  const ruc = normalizeRuc(rucValue);

  if (!/^\d{11}$/.test(ruc)) {
    throw new AppError(
      422,
      "SUNAT Padr贸n lookup requires an 11-digit RUC.",
      {
        ruc: rucValue
      },
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const lookup = await lookupSunatPadronRuc(ruc, { localOnly: true });

  const meta = datasetMeta(
    lookup.manifest
  );

  if (
    !lookup.found ||
    !lookup.record
  ) {
    return {
      found: false,

      ruc,

      source:
        "SUNAT_PUBLIC_PADRON_RUC",

      officialSource:
        true,

      ...meta,

      message:
        "RUC was not found in the currently downloaded SUNAT public Padr贸n Reducido."
    };
  }

  const record =
    lookup.record;

  const active =
    record.taxpayerStatus ===
    "ACTIVO";

  const habido =
    record.domicileCondition ===
    "HABIDO";

  return {
    found: true,

    ruc,

    source:
      "SUNAT_PUBLIC_PADRON_RUC",

    officialSource:
      true,

    ...meta,

    data: {
      rucDni:
        record.ruc,

      legalName:
        record.legalName || "",

      commercialName:
        "",

      personType:
        inferPersonType(
          record.ruc
        ),

      fiscalAddress:
        record.fiscalAddress ||
        "",

      location: {
        district:
          "",

        province:
          "",

        department:
          "",

        ubigeo:
          record.ubigeo || ""
      },

      taxpayerStatus:
        record.taxpayerStatus ||
        "NO_INFORMADO",

      domicileCondition:
        record.domicileCondition ||
        "NO_INFORMADO",

      active,

      habido,

      eligibleForHomologation:
        active &&
        habido,

      accountHolderName:
        record.legalName || "",

      roadType:
        record.roadType || "",

      roadName:
        record.roadName || "",

      addressNumber:
        record.number || "",

      interior:
        record.interior || "",

      lot:
        record.lot || "",

      block:
        record.block || "",

      kilometer:
        record.kilometer || ""
    },

    message:
      active && habido
        ? "SUNAT Padr贸n data loaded. The RUC is ACTIVO and HABIDO."
        : `SUNAT Padr贸n data loaded. Status: ${
            record.taxpayerStatus ||
            "NO_INFORMADO"
          }; domicile condition: ${
            record.domicileCondition ||
            "NO_INFORMADO"
          }.`
  };
}

// Public web profile first. A fallback never turns absence/unavailability into validation.
export async function getSupplierAutomaticPrefill(rucValue, { consulta = lookupSunatTaxpayerProfile, padron = getSupplierPadronPrefill } = {}) {
  const ruc = normalizeRuc(rucValue);
  if (!/^\d{11}$/.test(ruc)) throw new AppError(422, "SUNAT lookup requires an 11-digit RUC.");
  try { return await consulta(ruc); }
  catch (error) {
    const failure = classifyConsultaFailure(error);
    console.warn(`[SUNAT LOOKUP] Consulta RUC failed: ${failure.code}`);
    try {
      const result = await padron(ruc);
      return { ...result, fallback: true, primarySource: "SUNAT_CONSULTA_RUC", fallbackReason: failure.code, queriedAt: new Date().toISOString() };
    } catch (padronError) {
      console.warn("[SUNAT LOOKUP] Padr髇 fallback unavailable.");
      throw new AppError(503, `${failure.message} The SUNAT Padr髇 fallback is also unavailable.`, {
        consultaFailure: failure.code,
        requiresConfiguration: failure.requiresConfiguration,
        fallbackState: "UNAVAILABLE"
      });
    }
  }
}


// Stable, sanitized diagnostics: never return browser paths, stacks or raw HTML.
export function classifyConsultaFailure(error) {
  const message = String(error?.message || "");
  if (/executable doesn't exist|browser.*not installed/i.test(message)) {
    return { code: "CONSULTA_BROWSER_MISSING", requiresConfiguration: true, message: "Automatic lookup is not configured on the server: Chromium is missing. Administration must redeploy with the SUNAT browser build check." };
  }
  if (/shared libraries|host system is missing dependencies|error while loading/i.test(message)) {
    return { code: "CONSULTA_BROWSER_DEPENDENCIES", requiresConfiguration: true, message: "The server is missing browser system dependencies. Administration must correct the deployment." };
  }
  if (/HTTP 403|HTTP 429|human verification|interactive verification/i.test(message)) {
    return { code: "CONSULTA_ACCESS_RESTRICTED", requiresConfiguration: false, message: "SUNAT is restricting automated access from this server. The lookup cannot retrieve the profile right now." };
  }
  if (/timeout|timed out|has been closed/i.test(message)) {
    return { code: "CONSULTA_TIMEOUT", requiresConfiguration: false, message: "Consulta RUC did not respond within the lookup time limit." };
  }
  return { code: "CONSULTA_UNAVAILABLE", requiresConfiguration: false, message: "Consulta RUC could not return a usable supplier profile." };
}
