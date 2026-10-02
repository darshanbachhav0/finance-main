import { cloudTaxpayerMode } from "../../services/taxpayerProfileCache.js";
import { getSupplierAutomaticPrefill } from "../../services/supplierPadronLookupService.js";
import { AppError } from "../../utils/AppError.js";
import { ERROR_CODES } from "../../utils/constants.js";
import { getSunatPadronStatus, lookupSunatPadronRuc } from "../../services/sunatPadronService.js";
import { SunatProvider } from "./SunatProvider.js";

export const PADRON_NEVER_DOWNLOADED_MESSAGE =
  "The SUNAT public Padrón has never been downloaded on this server, so taxpayer status cannot be checked. Start the padrón sync worker (npm run sunat:padron:worker) or run a one-off sync; meanwhile Accounting can approve a manual SUNAT exception on the invoice.";

// The generic lookup error ("being prepared or refreshed") is misleading when no dataset was ever
// downloaded; tell the user what is actually wrong.
async function lookupPadronOrExplain(ruc) {
  try {
    return await lookupSunatPadronRuc(ruc);
  } catch (error) {
    if (error?.statusCode !== 503) throw error;
    const status = await getSunatPadronStatus().catch(() => null);
    if (status && !status.ready && !status.manifest?.generatedAt) {
      throw new AppError(503, PADRON_NEVER_DOWNLOADED_MESSAGE, { padron: "NEVER_DOWNLOADED" }, ERROR_CODES.INTEGRATION_NOT_CONFIGURED);
    }
    throw error;
  }
}

function digits(value) {
  return String(
    value ?? ""
  ).replace(/\D/g, "");
}

function text(value) {
  return String(
    value ?? ""
  ).trim();
}

export class PublicPadronSunatProvider extends SunatProvider {
  constructor() {
    /*
     * mode=PRODUCTION is intentional.
     *
     * Existing supplier-homologation logic treats an official
     * production SUNAT source as authoritative for taxpayer
     * validation.
     *
     * variant/source/capabilities make clear that this is the
     * public Padrón and NOT the credentialed CPE API.
     */
    super({
      mode: "PRODUCTION",
      configured: true
    });

    this.variant =
      "PADRON";

    this.source =
      "SUNAT_PUBLIC_PADRON_RUC";

    this.capabilities =
      Object.freeze({
        taxpayerRuc: true,

        taxpayerLegalName:
          true,

        taxpayerStatus:
          true,

        domicileCondition:
          true,

        fiscalAddress:
          true,

        voucherExistence:
          false,

        voucherAcceptance:
          false,

        exchangeRate:
          false
      });
  }

  async validateTaxpayer(
    identifier
  ) {
    const ruc =
      digits(identifier);

    if (
      !/^\d{11}$/.test(
        ruc
      )
    ) {
      return {
        valid: false,

        source:
          this.source,

        official: true,

        publicDataset:
          true,

        status:
          "RUC_INVALIDO",

        condition:
          "NO_VERIFICADO",

        returnedIdentifier:
          ruc,

        returnedLegalName:
          "",

        message:
          "The SUNAT public Padrón validates 11-digit RUC values only."
      };
    }

    if (cloudTaxpayerMode()) {
      const profile = await getSupplierAutomaticPrefill(ruc);
      const data = profile.data || {};
      return {
        valid: profile.found === true && data.active === true && data.habido === true,
        official: profile.officialSource === true, source: profile.source,
        publicDataset: profile.source === "SUNAT_PUBLIC_PADRON_RUC",
        status: data.taxpayerStatus || "NO_ENCONTRADO", condition: data.domicileCondition || "NO_ENCONTRADO",
        taxpayerStatus: data.taxpayerStatus, returnedIdentifier: data.rucDni || ruc,
        returnedLegalName: data.legalName || "", legalName: data.legalName || "",
        fiscalAddress: data.fiscalAddress, ubigeo: data.location?.ubigeo,
        datasetDate: profile.datasetDate, queriedAt: profile.queriedAt,
        cacheExpiresAt: profile.cacheExpiresAt,
        comments: `Official taxpayer lookup: ${profile.source}; ${profile.queriedAt || profile.datasetDate}`,
        message: profile.message
      };
    }

    const lookup =
      await lookupPadronOrExplain(
        ruc
      );

    if (
      !lookup.found ||
      !lookup.record
    ) {
      return {
        valid: false,

        source:
          this.source,

        official: true,

        publicDataset:
          true,

        status:
          "NO_ENCONTRADO",

        condition:
          "NO_ENCONTRADO",

        returnedIdentifier:
          ruc,

        returnedLegalName:
          "",

        datasetDate:
          lookup.manifest
            ?.datasetDate ||
          "",

        datasetGeneratedAt:
          lookup.manifest
            ?.generatedAt,

        message:
          "RUC was not found in the downloaded SUNAT public Padrón Reducido."
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

    const valid =
      active &&
      habido;

    return {
      valid,

      source:
        this.source,

      official: true,

      publicDataset:
        true,

      status:
        record.taxpayerStatus ||
        "NO_INFORMADO",

      condition:
        record.domicileCondition ||
        "NO_INFORMADO",

      taxpayerStatus:
        record.taxpayerStatus ||
        "NO_INFORMADO",

      returnedIdentifier:
        record.ruc,

      returnedLegalName:
        record.legalName,

      legalName:
        record.legalName,

      ubigeo:
        record.ubigeo,

      fiscalAddress:
        record.fiscalAddress,

      datasetDate:
        lookup.manifest
          ?.datasetDate ||
        "",

      datasetGeneratedAt:
        lookup.manifest
          ?.generatedAt,

      comments:
        `SUNAT public Padrón: ${
          record.taxpayerStatus ||
          "NO_INFORMADO"
        } / ${
          record.domicileCondition ||
          "NO_INFORMADO"
        }${
          lookup.manifest
            ?.datasetDate
            ? `; dataset ${lookup.manifest.datasetDate}`
            : ""
        }.`,

      message:
        valid
          ? "RUC is ACTIVO and HABIDO in the official SUNAT public Padrón Reducido."
          : `RUC is not eligible: status ${
              record.taxpayerStatus ||
              "NO_INFORMADO"
            }, condition ${
              record.domicileCondition ||
              "NO_INFORMADO"
            }.`
    };
  }

  async validateVoucher(
    voucher = {}
  ) {
    const ruc =
      digits(
        voucher.ruc ||
        voucher.issuerRuc ||
        voucher.rucIssuer
      );

    const series =
      text(
        voucher.series
      ).toUpperCase();

    const number =
      text(
        voucher.number
      ).toUpperCase();

    if (
      !series ||
      !number
    ) {
      return {
        valid: false,

        source:
          this.source,

        official: true,

        publicDataset:
          true,

        authoritative:
          false,

        voucherVerified:
          false,

        status:
          "DATOS_COMPROBANTE_INVALIDOS",

        message:
          "Voucher series and number are required."
      };
    }

    const taxpayer =
      await this.validateTaxpayer(
        ruc
      );

    if (!taxpayer.valid) {
      return {
        valid: false,

        source:
          this.source,

        official: true,

        publicDataset:
          true,

        authoritative:
          false,

        voucherVerified:
          false,

        status:
          `RUC_${
            taxpayer.status ||
            taxpayer.condition ||
            "INVALIDO"
          }`,

        taxpayer,

        message:
          taxpayer.message
      };
    }

    return {
      valid: false,

      source:
        this.source,

      official: true,

      publicDataset:
        true,

      authoritative:
        false,

      voucherVerified:
        false,

      status:
        "PADRON_RUC_VERIFIED_CPE_NOT_VALIDATED",

      taxpayer,

      datasetDate:
        taxpayer.datasetDate,

      message:
        "Issuer RUC is ACTIVO/HABIDO in the official SUNAT public Padrón. This public dataset does not confirm existence, acceptance, cancellation, date, or amount of the specific CPE."
    };
  }

  async getSellingExchangeRate({
    date
  }) {
    throw new AppError(
      422,
      "The SUNAT public Padrón does not provide exchange rates.",
      {
        date,
        provider:
          this.source
      },
      ERROR_CODES
        .EXCHANGE_RATE_MISSING
    );
  }
}