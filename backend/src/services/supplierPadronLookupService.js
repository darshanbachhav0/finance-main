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
      "SUNAT Padrón lookup requires an 11-digit RUC.",
      {
        ruc: rucValue
      },
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const lookup = await lookupSunatPadronRuc(ruc);

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
        "RUC was not found in the currently downloaded SUNAT public Padrón Reducido."
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
        ? "SUNAT Padrón data loaded. The RUC is ACTIVO and HABIDO."
        : `SUNAT Padrón data loaded. Status: ${
            record.taxpayerStatus ||
            "NO_INFORMADO"
          }; domicile condition: ${
            record.domicileCondition ||
            "NO_INFORMADO"
          }.`
  };
}