import { archiveAsset } from "./durableAssetService.js";
/*
 * SIRE - Registro de Compras Electronico (RCE): replacement-of-proposal TXT ("reemplazo de la
 * propuesta"). UMA is the buyer, so this module only produces the RCE, never the RVIE.
 *
 * Structure implemented: "ANEXO 11 - Estructura y reglas para elaborar el archivo plano que permita
 * la comparacion con la propuesta del RCE o reemplazar esta ultima", as published in Anexo F of
 * Resolucion de Superintendencia N.o 000040-2022/SUNAT (which modified RS 000112-2021/SUNAT).
 * RS 000138-2023/SUNAT (art. 3) modified Anexos 1, 2-5, 8, 12 and 13 but not Anexo 11, so the
 * 2022 text is treated as the current version (structure tag RCE_ANEXO11_RS040_2022).
 * File name: Tabla 13.1 of Anexo 1 (Anexo B of RS 040-2022):
 *   LE + RUC(11) + AAAA + MM + "00" + "080400" + "02" + O + I + M + "2" + ".TXT"
 * General rules: Tabla 12 of Anexo 1 (pipe separator, "-#.##" negatives, text/alfanumeric chars).
 * Document types: Tabla 11 of Anexo 1 (SIRE numbering; same codes as PLE Tabla 10).
 * Identity documents: Tabla 12 "Reglas de tipo y numero de documento de identidad" (PLE Tabla 2).
 *
 * Sources (retrieved 2026-09-25):
 *   https://www.sunat.gob.pe/legislacion/superin/2022/anexo-040-2022.pdf   (Anexo 1 tablas 11-13, Anexo 11)
 *   https://www.sunat.gob.pe/legislacion/superin/2022/040-2022.pdf
 *   https://www.sunat.gob.pe/legislacion/superin/2023/000138-2023.pdf     (confirms Anexo 11 not modified)
 *   https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Compras%20v24.pdf
 *     (API upload of the replacement: codProceso 61, codLibro 080000, zipped TXT - not implemented here)
 *
 * Every rule that could not be confirmed verbatim in those documents is marked "VERIFY:".
 * This module prepares the file only; nothing is submitted to SUNAT.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import JournalEntry from "../models/JournalEntry.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { SireProvider } from "../integrations/sire/SireProvider.js";
import { generatedRoot } from "./storageService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES } from "../utils/constants.js";

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;

export const RCE_STRUCTURE = Object.freeze({
  version: "RCE_ANEXO11_RS040_2022",
  description: "SUNAT RCE - Anexo 11 (reemplazo de la propuesta), RS 000040-2022/SUNAT Anexo F",
  fieldCount: 37,
  separator: "|",
  // VERIFY: Anexo 11 does not state the line terminator. CRLF is what SUNAT's PLE/SIRE sample files use.
  lineEnding: "\r\n",
  // VERIFY: Anexo 11 does not state the character encoding. UTF-8 without BOM is used; names are
  // restricted to the Tabla 12 character set, so the output is effectively ASCII plus Spanish letters.
  encoding: "utf8",
  // VERIFY: Anexo 11 only describes data records; no header line is written. The free-use fields
  // (42-80) "no incluya ni la informacion ni los palotes", which reads as "|" being a separator,
  // so no trailing pipe is written after field 37. Fields 38-41 are completed by SUNAT (note 6).
  trailingSeparator: false,
  headerLine: false
});

// Tabla 11 (SIRE) / Tabla 10 (PLE) - tipo de comprobante de pago o documento.
const DOCUMENT_TYPE_ALIASES = Object.freeze({
  "01": ["FACTURA", "FACTURA_ELECTRONICA", "INVOICE", "FT", "FAC"],
  "02": ["RECIBO_HONORARIOS", "RECIBO_POR_HONORARIOS", "RHE", "RH", "RECIBO_HONORARIO"],
  "03": ["BOLETA", "BOLETA_VENTA", "BOLETA_DE_VENTA", "BV"],
  "04": ["LIQUIDACION_COMPRA", "LIQUIDACION_DE_COMPRA"],
  "07": ["NOTA_CREDITO", "NOTA_DE_CREDITO", "CREDIT_NOTE", "NC"],
  "08": ["NOTA_DEBITO", "NOTA_DE_DEBITO", "DEBIT_NOTE", "ND"],
  "12": ["TICKET", "TICKET_MAQUINA_REGISTRADORA"],
  "14": ["RECIBO_SERVICIOS_PUBLICOS", "SERVICIOS_PUBLICOS", "RECIBO_SERVICIO_PUBLICO"],
  "50": ["DAM", "DUA", "DECLARACION_ADUANERA"]
});
const DOCUMENT_TYPE_BY_ALIAS = new Map(
  Object.entries(DOCUMENT_TYPE_ALIASES).flatMap(([code, aliases]) => aliases.map((alias) => [alias, code]))
);
// Codes Anexo 11 field 7 refuses for a replacement.
const FORBIDDEN_REPLACEMENT_TYPES = new Set(["91", "97", "98"]);
const NOTE_TYPES = new Set(["07", "08", "87", "88"]);
const NEGATIVE_TYPES = new Set(["07", "87"]);
const CUSTOMS_TYPES = new Set(["50", "51", "52", "53", "54"]);
const DUE_DATE_TYPES = new Set(["14", "46", "50", "51", "52", "53", "54"]);
// Field 23 (ICBPER) "Obligatorio si el campo 7 = '01', '03', '07', '08' o '12'. De no tener informacion consignar 0.00."
const IGV_DESTINATIONS = new Set(["DG", "DGNG", "DNG"]);

export function rceDocumentTypeCode(value) {
  const text = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!text) return "";
  if (/^\d{1,2}$/.test(text)) return text.padStart(2, "0");
  return DOCUMENT_TYPE_BY_ALIAS.get(text) || "";
}

// Tabla 12 identity rules: 6 = RUC (11, numeric, fixed, modulo 11), 1 = DNI (8, numeric, fixed),
// 4 = carnet de extranjeria, 7 = pasaporte, 0 = doc. tributario no domiciliado sin RUC.
export function identityDocumentCode(identifier, identifierType) {
  const type = String(identifierType || "").trim().toUpperCase();
  const digits = String(identifier || "").replace(/\s/g, "");
  if (type === "RUC" || (!type && /^\d{11}$/.test(digits))) return "6";
  if (type === "DNI" || (!type && /^\d{8}$/.test(digits))) return "1";
  if (["CE", "CARNET_EXTRANJERIA"].includes(type)) return "4";
  if (["PASAPORTE", "PASSPORT"].includes(type)) return "7";
  return "";
}

export function isValidRuc(value) {
  const ruc = String(value || "");
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(ruc[index]), 0);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(ruc[10]);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Tabla 12 rule 1 and Anexo 11 fields 15-25: up to 12 integers and 2 decimals, no thousands
// separator, negatives as "-#.##".
export function formatSireAmount(value) {
  const amount = round2(value || 0);
  return (Object.is(amount, -0) ? 0 : amount).toFixed(2);
}

// Field 27: "Formato #.###" (1 integer and 3 decimals).
export function formatSireExchangeRate(value) {
  return (Math.round((Number(value) + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function toDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// DD/MM/AAAA. Dates are read in UTC, matching how the rest of the platform stores date-only
// fiscal values (the ISO date of the stored instant).
export function formatSireDate(value) {
  const date = toDate(value);
  if (!date) return "";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

function isoDate(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function periodKey(value) {
  const date = toDate(value);
  return date ? `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}` : "";
}

// Tabla 12 rules 2/3: text may not contain | / \ ; alfanumeric = letters, digits and ( ) , . -
export function sanitizeSireText(value, maxLength = 1500) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[|/\\]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sireTaxpayerConfiguration(env = process.env) {
  const destination = String(env.SIRE_RCE_IGV_DESTINATION || "DG").trim().toUpperCase();
  const bookCurrency = String(env.SIRE_RCE_BOOK_CURRENCY || "PEN").trim().toUpperCase();
  return {
    ruc: String(env.SIRE_TAXPAYER_RUC || "").replace(/\D/g, ""),
    name: sanitizeSireText(env.SIRE_TAXPAYER_NAME || ""),
    // VERIFY: which Anexo 11 column pair (15/16 DG, 17/18 DGNG or 19/20 DNG) UMA's IGV credit
    // belongs in depends on whether UMA's own operations are taxed. This is an accounting decision;
    // the default "DG" must be confirmed by UMA's accountant.
    igvDestination: IGV_DESTINATIONS.has(destination) ? destination : "DG",
    igvDestinationValid: IGV_DESTINATIONS.has(destination),
    bookCurrency: bookCurrency === "USD" ? "USD" : "PEN"
  };
}

function configurationErrors(config) {
  const errors = [];
  if (!config.ruc) errors.push("UMA's RUC (SIRE_TAXPAYER_RUC) is not configured.");
  else if (!isValidRuc(config.ruc)) errors.push("UMA's RUC (SIRE_TAXPAYER_RUC) is not a valid RUC.");
  if (!config.name) errors.push("UMA's legal name (SIRE_TAXPAYER_NAME) is not configured.");
  if (!config.igvDestinationValid) errors.push("SIRE_RCE_IGV_DESTINATION must be DG, DGNG or DNG.");
  return errors;
}

/**
 * Tabla 13.1: LE + RUC + AAAA + MM + 00 + 080400 + CC + O + I + M + G + .TXT
 *   CC = 02 (RCE cuando reemplaza la propuesta), O = 1 (empresa operativa),
 *   I = 1 con informacion / 0 sin informacion, M = 1 soles / 2 US dolares, G = 2 (SIRE, fijo).
 */
export function rceFileName({ ruc, period, hasInformation = true, bookCurrency = "PEN" }) {
  const [year, month] = String(period).split("-");
  return `LE${ruc}${year}${month}00080400021${hasInformation ? "1" : "0"}${bookCurrency === "USD" ? "2" : "1"}2.TXT`;
}

function populated(value) {
  return value && typeof value === "object" && value._id ? value : null;
}

function idOf(value) {
  return String(value?._id || value || "");
}

export function sireVoucherKey({ supplierRuc, supplierRucDni, rucIssuer, documentType, voucherType, series, number } = {}) {
  const ruc = String(supplierRuc || supplierRucDni || rucIssuer || "").replace(/\D/g, "");
  return [ruc, documentType || voucherType, series, number]
    .map((value) => String(value || "").trim().toUpperCase())
    .join("|");
}

export function hasAuthoritativeVoucherValidation(voucher) {
  if (!voucher || voucher.validationStatus !== "VALID") return false;
  const evidence = voucher.validationEvidence;
  const fiscal = evidence?.fiscal;
  if (evidence?.valid !== true || fiscal?.valid !== true) return false;
  if (fiscal.voucherVerified === false || fiscal.publicDataset === true) return false;
  if (process.env.NODE_ENV === "production" && fiscal.source === "MOCK") return false;
  return true;
}

function supplierFrom(payable, request) {
  return populated(payable.supplier) || populated(request?.supplier);
}

function supplierName(payable, request) {
  const supplier = supplierFrom(payable, request);
  return supplier?.legalName || supplier?.name || request?.supplierSnapshot?.legalName || "";
}

function accountingJournal(payable, journalsByPayable) {
  return populated(payable.provisionJournal) || journalsByPayable.get(idOf(payable));
}

// Credit/debit notes: the reference to the modified document is read from whichever shape the
// accounting module stores it in. VERIFY: field names must be aligned with the credit-note model
// once the parallel accounting change lands (referenceDocument is the preferred shape).
const REFERENCE_KEYS = ["referenceDocument", "modifiedDocument", "originalDocument", "reference"];
function referenceCandidate(source) {
  if (!source || typeof source !== "object") return null;
  for (const key of REFERENCE_KEYS) {
    const value = source[key];
    if (value && typeof value === "object" && !(value instanceof Date)) return value;
  }
  return null;
}

function referenceVoucherId(source) {
  if (!source || typeof source !== "object") return "";
  return idOf(source.referenceVoucher || source.originalVoucher || source.modifiedVoucher || "");
}

function referenceDocumentOf(voucher, payable, referencedVouchers) {
  const linkedId = referenceVoucherId(voucher) || referenceVoucherId(payable);
  const linked = linkedId ? referencedVouchers.get(linkedId) : null;
  if (linked) {
    return { documentType: linked.voucherType, series: linked.series, number: linked.number, issueDate: linked.issueDate };
  }
  const reference = referenceCandidate(voucher)
    || referenceCandidate(voucher?.validationEvidence)
    || referenceCandidate(voucher?.validationEvidence?.fiscal)
    || referenceCandidate(payable?.voucher)
    || referenceCandidate(payable);
  if (!reference) return null;
  return {
    documentType: reference.documentType || reference.voucherType || reference.type || "",
    series: reference.series || "",
    number: reference.number || "",
    issueDate: reference.issueDate || reference.documentDate || reference.date || null
  };
}

function rowFromPayable({ payable, voucher, journal, period, exportedKeys }) {
  const request = populated(payable.request);
  const supplier = supplierFrom(payable, request);
  const documentType = voucher?.voucherType || payable.voucher?.voucherType || payable.voucher?.documentType || "";
  const series = voucher?.series || payable.voucher?.series || "";
  const number = voucher?.number || payable.voucher?.number || "";
  const supplierRuc = voucher?.rucIssuer || payable.supplierIdentifierSnapshot || supplier?.normalizedIdentifier || supplier?.rucDni || request?.supplierSnapshot?.identifier || "";
  const currency = voucher?.currency || payable.currency || "";
  const voucherKey = sireVoucherKey({ supplierRuc, documentType, series, number });
  return {
    id: idOf(payable),
    accountsPayableId: idOf(payable),
    accountsPayableStatus: payable.status || "",
    voucherId: idOf(voucher),
    voucherKey,
    supplierRuc,
    supplierIdentifierType: supplier?.identifierType || "",
    supplierName: supplierName(payable, request),
    documentType,
    documentTypeCode: rceDocumentTypeCode(documentType),
    series,
    number,
    invoiceDate: isoDate(voucher?.issueDate || payable.voucher?.documentDate),
    dueDate: isoDate(payable.dueDate),
    fiscalPeriod: journal?.period || request?.fiscalData?.fiscalPeriod || request?.accountingPeriod || period,
    accountingDate: isoDate(journal?.postedAt || request?.fiscalData?.accountingDate),
    currency,
    subtotal: voucher?.netAmount ?? null,
    igv: voucher?.igvAmount ?? null,
    total: voucher?.xmlAmount ?? payable.originalAmount ?? null,
    exchangeRate: currency && currency !== "PEN" ? (payable.exchangeRate ?? null) : null,
    requestReference: request?.requestNumber || "",
    requestId: idOf(request),
    cxpReference: idOf(payable),
    fiscalValidationStatus: voucher?.validationStatus || "MISSING_VOUCHER_LINK",
    exportStatus: voucherKey && exportedKeys.has(voucherKey) ? "EXPORTED" : "PENDING"
  };
}

function validateCandidate(row, voucher) {
  const errors = [];
  const warnings = [];
  if (!voucher) errors.push("A valid SunatVoucher link is missing; manual review is required.");
  if (voucher && !hasAuthoritativeVoucherValidation(voucher)) errors.push("Individual fiscal voucher validation has not passed.");
  if (!row.supplierRuc) errors.push("Supplier RUC is missing.");
  if (!row.supplierName) errors.push("Supplier name is missing.");
  if (!row.documentType) errors.push("Document type is missing.");
  if (!row.series) errors.push("Voucher series is missing.");
  if (!row.number) errors.push("Voucher number is missing.");
  if (!row.invoiceDate) errors.push("Invoice date is missing.");
  if (!row.accountingDate) errors.push("Accounting posting date is missing.");
  if (!row.fiscalPeriod) errors.push("Fiscal period is missing.");
  if (!row.currency) errors.push("Currency is missing.");
  if (row.subtotal === null || row.subtotal === undefined) errors.push("Voucher subtotal is missing.");
  if (row.igv === null || row.igv === undefined) errors.push("Voucher IGV is missing.");
  if (row.total === null || row.total === undefined) errors.push("Voucher total is missing.");
  if (row.currency && row.currency !== "PEN" && !(Number(row.exchangeRate) > 0)) errors.push("USD voucher exchange rate is missing.");
  return { errors, warnings };
}

const AMOUNT_LIMIT = 1e12; // "Hasta 12 enteros"

/**
 * Builds the 37 Anexo 11 fields for one voucher and validates them against the Anexo 11 rules.
 * Returns { fields, errors, warnings }. `fields` is only meaningful when errors is empty.
 */
export function buildRceFields(row, { config, period, reference }) {
  const errors = [];
  const warnings = [];
  const code = row.documentTypeCode;
  const periodCompact = String(period).replace("-", "");

  if (!code) errors.push(`Document type "${row.documentType || "-"}" has no SUNAT Tabla 10/11 code; it cannot be filed in the RCE.`);
  else if (FORBIDDEN_REPLACEMENT_TYPES.has(code)) errors.push(`Document type ${code} is not allowed in an RCE replacement (Anexo 11, field 7).`);

  const identifier = String(row.supplierRuc || "").replace(/\s/g, "");
  const identityCode = identityDocumentCode(identifier, row.supplierIdentifierType);
  if (!identityCode) errors.push("Supplier identity document type cannot be mapped to SUNAT Tabla 2.");
  if (identityCode === "6" && !isValidRuc(identifier)) errors.push(`Supplier RUC ${identifier || "-"} is not a valid RUC (11 digits, check digit).`);
  if (identityCode === "1" && !/^\d{8}$/.test(identifier)) errors.push("Supplier DNI must have 8 digits.");
  if (["01", "07", "08"].includes(code) && identityCode && identityCode !== "6") errors.push("A factura or note must be issued by a supplier identified with a RUC.");

  const series = sanitizeSireText(row.series, 20).toUpperCase();
  const number = String(row.number || "").trim().toUpperCase();
  if (series && !/^[A-Z0-9]{1,20}$/.test(series)) errors.push("Voucher series must be alphanumeric, up to 20 characters.");
  // VERIFY: SIRE compares numbers without leading zeros for electronic vouchers; zeros are removed
  // from purely numeric numbers.
  const numberOut = /^\d+$/.test(number) ? String(Number(number)) : number;
  if (number && !/^[A-Z0-9-]{1,20}$/.test(number)) errors.push("Voucher number must be alphanumeric, up to 20 characters.");

  const issue = row.invoiceDate ? `${row.invoiceDate.slice(0, 4)}${row.invoiceDate.slice(5, 7)}` : "";
  if (issue && issue > periodCompact) errors.push("Issue date is later than the RCE period (Anexo 11, field 5).");

  const due = DUE_DATE_TYPES.has(code) ? row.dueDate : "";
  if (DUE_DATE_TYPES.has(code) && !due) errors.push("Due/payment date is required for this document type (Anexo 11, field 6).");

  const currency = String(row.currency || "").toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push("Currency must be an ISO 4217 code (Tabla 2 Tipo de moneda).");
  const needsRate = currency && currency !== config.bookCurrency;
  const rate = Number(row.exchangeRate);
  if (needsRate && !(rate > 0)) errors.push("Exchange rate is required for a foreign-currency voucher (Anexo 11, field 27).");
  if (needsRate && rate > 0 && Math.abs(Number(formatSireExchangeRate(rate)) - rate) > 1e-9) warnings.push(`Exchange rate ${rate} is rounded to ${formatSireExchangeRate(rate)} (format #.###).`);

  const net = Math.abs(Number(row.subtotal || 0));
  const igv = Math.abs(Number(row.igv || 0));
  const total = Math.abs(Number(row.total || 0));
  const taxedBase = igv > 0 ? net : 0;
  const nonTaxed = igv > 0 ? 0 : net;
  const others = 0;
  if (Math.abs(round2(taxedBase + igv + nonTaxed + others) - round2(total)) > 0.01) {
    errors.push(`Amounts do not add up: base ${formatSireAmount(net)} + IGV ${formatSireAmount(igv)} differs from total ${formatSireAmount(total)}.`);
  }
  if (igv > 0 && net > 0) {
    const ratio = igv / net;
    // VERIFY: a voucher mixing taxed and exempt lines cannot be split from header totals; such
    // vouchers are flagged for review instead of being guessed.
    if (Math.abs(ratio - 0.18) > 0.005 && Math.abs(ratio - 0.10) > 0.005) warnings.push("IGV is not 18% (or 10%) of the base; confirm the voucher has no exempt lines.");
  }
  if ([net, igv, total].some((value) => value >= AMOUNT_LIMIT)) errors.push("Amount exceeds 12 integer digits.");

  const sign = NEGATIVE_TYPES.has(code) ? -1 : 1;
  const amount = (value) => formatSireAmount(sign * value);

  const ref = NOTE_TYPES.has(code) ? reference : null;
  const refCode = ref ? rceDocumentTypeCode(ref.documentType) : "";
  if (NOTE_TYPES.has(code)) {
    if (!ref) errors.push("Credit/debit note does not reference the document it modifies (Anexo 11, fields 28-32).");
    else {
      if (!formatSireDate(ref.issueDate)) errors.push("Issue date of the modified document is missing (field 28).");
      else if (periodKey(ref.issueDate) > periodCompact) errors.push("Issue date of the modified document is later than the RCE period (field 28).");
      if (!refCode) errors.push("Type of the modified document is missing or has no Tabla 10/11 code (field 29).");
      if (!ref.series) errors.push("Series of the modified document is missing (field 30).");
      if (!ref.number) errors.push("Number of the modified document is missing (field 32).");
    }
  }
  const refNumber = ref && /^\d+$/.test(String(ref.number || "")) ? String(Number(ref.number)) : String(ref?.number || "").toUpperCase();

  const name = sanitizeSireText(row.supplierName);
  if (!name) errors.push("Supplier name is missing.");

  const zero = amount(0);
  const destination = config.igvDestination;
  const fields = [
    config.ruc,                                             // 1 RUC del generador
    config.name,                                            // 2 Razon social del generador
    periodCompact,                                          // 3 Periodo AAAAMM
    "",                                                     // 4 CAR (vacio, lo completa SUNAT)
    formatSireDate(row.invoiceDate),                        // 5 Fecha de emision
    due ? formatSireDate(due) : "",                         // 6 Fecha de vencimiento / pago
    code,                                                   // 7 Tipo de CP (Tabla 11)
    series,                                                 // 8 Serie
    "",                                                     // 9 Anio DAM/DSI (solo tipos 50-54)
    numberOut,                                              // 10 Numero (o inicial del rango)
    "",                                                     // 11 Numero final (consolidado diario, no usado)
    identityCode,                                           // 12 Tipo doc. identidad proveedor (Tabla 2)
    identifier,                                             // 13 Numero doc. identidad proveedor
    name,                                                   // 14 Razon social proveedor
    destination === "DG" ? amount(taxedBase) : zero,        // 15 BI gravada DG
    destination === "DG" ? amount(igv) : zero,              // 16 IGV DG
    destination === "DGNG" ? amount(taxedBase) : zero,      // 17 BI gravada DGNG
    destination === "DGNG" ? amount(igv) : zero,            // 18 IGV DGNG
    destination === "DNG" ? amount(taxedBase) : zero,       // 19 BI gravada DNG
    destination === "DNG" ? amount(igv) : zero,             // 20 IGV DNG
    amount(nonTaxed),                                       // 21 Valor adquisiciones no gravadas
    zero,                                                   // 22 ISC
    zero,                                                   // 23 ICBPER
    amount(others),                                         // 24 Otros tributos/cargos
    amount(total),                                          // 25 Importe total
    currency,                                               // 26 Moneda (ISO 4217)
    // VERIFY: field 27 is only mandatory for a currency other than the books' currency; it is left
    // empty for PEN vouchers.
    needsRate && rate > 0 ? formatSireExchangeRate(rate) : "", // 27 Tipo de cambio #.###
    ref ? formatSireDate(ref.issueDate) : "",               // 28 Fecha emision doc. modificado
    ref ? refCode : "",                                     // 29 Tipo CP modificado
    ref ? sanitizeSireText(ref.series, 20).toUpperCase() : "", // 30 Serie CP modificado
    "",                                                     // 31 Codigo DAM/DSI modificado (tipos 50/52)
    ref ? refNumber : "",                                   // 32 Numero CP modificado
    // VERIFY: field 33 (clasificacion de bienes y servicios) applies only to taxpayers with income
    // above 1,500 UIT in the previous year; left empty until UMA's accountant confirms.
    "",                                                     // 33 Clasificacion de bienes y servicios
    "",                                                     // 34 ID proyecto (operadores / participes)
    "",                                                     // 35 % participacion
    // VERIFY: field 36 (IMB, Ley 31053 - fomento editorial) does not apply to UMA; left empty.
    "",                                                     // 36 IMB
    ""                                                      // 37 CAR del CP a modificar (solo ajustes posteriores)
  ];
  return { fields, errors, warnings };
}

export function buildRceLine(fields) {
  return fields.join(RCE_STRUCTURE.separator) + (RCE_STRUCTURE.trailingSeparator ? RCE_STRUCTURE.separator : "");
}

export function buildRceTxt(lines) {
  return lines.map((line) => `${line}${RCE_STRUCTURE.lineEnding}`).join("");
}

async function exportedVoucherKeys(period) {
  const history = await GeneratedFile.find({ kind: "SIRE_CSV", period }).select("metadata.voucherKeys").lean();
  return new Set(history.flatMap((file) => file.metadata?.voucherKeys || []).filter(Boolean));
}

async function candidatePayables(period) {
  const requestIds = await FinancialRequest.find({
    $or: [{ accountingPeriod: period }, { "fiscalData.fiscalPeriod": period }]
  }).distinct("_id");
  const journalPayableIds = await JournalEntry.find({
    period,
    entryType: "PROVISION",
    status: { $ne: "VOID" },
    accountsPayable: { $ne: null }
  }).distinct("accountsPayable");
  const conditions = [];
  if (requestIds.length) conditions.push({ request: { $in: requestIds } });
  if (journalPayableIds.length) conditions.push({ _id: { $in: journalPayableIds } });
  if (!conditions.length) return [];
  // Lean so that credit-note reference fields stored by the accounting module are visible even
  // before they are declared in these schemas.
  return AccountsPayable.find({ $or: conditions })
    .populate({
      path: "request",
      select: "requestNumber accountingPeriod fiscalData supplier supplierSnapshot flowType",
      populate: { path: "supplier", select: "rucDni normalizedIdentifier identifierType legalName name" }
    })
    .populate("supplier", "rucDni normalizedIdentifier identifierType legalName name")
    .populate("sunatVoucher")
    .populate("provisionJournal", "period postedAt createdAt status")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
}

export async function buildSirePreview(period) {
  if (!PERIOD_PATTERN.test(String(period || ""))) throw new AppError(422, "A valid period is required.", { period }, ERROR_CODES.VALIDATION_ERROR);
  const config = sireTaxpayerConfiguration();
  const configErrors = configurationErrors(config);
  const payables = await candidatePayables(period);
  const payableIds = payables.map((payable) => payable._id);
  const [reverseVouchers, journals, exportedKeys] = await Promise.all([
    payableIds.length ? SunatVoucher.find({ accountsPayable: { $in: payableIds } }).lean() : [],
    payableIds.length ? JournalEntry.find({ accountsPayable: { $in: payableIds }, entryType: "PROVISION", status: { $ne: "VOID" } }).sort({ postedAt: 1, createdAt: 1 }).lean() : [],
    exportedVoucherKeys(period)
  ]);
  const vouchersByPayable = new Map(reverseVouchers.map((voucher) => [idOf(voucher.accountsPayable), voucher]));
  const journalsByPayable = new Map(journals.map((journal) => [idOf(journal.accountsPayable), journal]));
  const voucherFor = (payable) => populated(payable.sunatVoucher) || vouchersByPayable.get(idOf(payable));
  const referencedIds = [...new Set(payables.flatMap((payable) => [referenceVoucherId(voucherFor(payable)), referenceVoucherId(payable)]).filter(Boolean))];
  const referencedVouchers = new Map(
    (referencedIds.length ? await SunatVoucher.find({ _id: { $in: referencedIds } }).lean() : []).map((voucher) => [idOf(voucher), voucher])
  );
  const seenVoucherKeys = new Set();
  const records = [];

  for (const payable of payables) {
    const request = populated(payable.request);
    const journal = accountingJournal(payable, journalsByPayable);
    const resolvedPeriod = journal?.period || request?.fiscalData?.fiscalPeriod || request?.accountingPeriod;
    if (resolvedPeriod !== period) continue;
    const voucher = voucherFor(payable);
    const row = rowFromPayable({ payable, voucher, journal, period, exportedKeys });
    const base = { id: row.id, accountsPayableId: row.accountsPayableId, voucherId: row.voucherId, voucherKey: row.voucherKey, requestId: row.requestId, requestNumber: row.requestReference };

    // Anexo 11 note 2: vouchers "dados de baja, revertidos o anulados" are not annotated. A
    // cancelled CXP is reported as excluded, never written to the file and never blocking.
    // VERIFY: a CANCELLED CXP is an internal reversal; whether the supplier also voided the
    // voucher at SUNAT (baja / NC tipo 02) must be confirmed by Accounting.
    if (payable.status === AP_STATUS.CANCELLED) {
      row.exportStatus = "EXCLUDED";
      records.push({ ...base, eligible: false, excluded: true, excludedReason: "CANCELLED", manualReview: false, duplicate: false, errors: [], warnings: ["Cancelled accounts payable: excluded from the RCE."], row });
      continue;
    }

    const validation = validateCandidate(row, voucher);
    let duplicate = false;
    if (row.voucherKey && !row.voucherKey.startsWith("|||")) {
      duplicate = seenVoucherKeys.has(row.voucherKey);
      if (!duplicate) seenVoucherKeys.add(row.voucherKey);
    }
    if (duplicate) {
      row.exportStatus = "EXCLUDED";
      records.push({ ...base, eligible: false, excluded: true, excludedReason: "DUPLICATE", manualReview: true, duplicate: true, errors: ["Duplicate fiscal document candidate was excluded from this SIRE export."], warnings: [], row });
      continue;
    }

    const reference = referenceDocumentOf(voucher, payable, referencedVouchers);
    const layout = buildRceFields(row, { config, period, reference });
    const errors = [...new Set([...validation.errors, ...layout.errors])];
    const warnings = [...new Set([...validation.warnings, ...layout.warnings])];
    const eligible = errors.length === 0;
    if (!eligible) row.exportStatus = "MANUAL_REVIEW";
    if (reference) row.reference = { ...reference, issueDate: isoDate(reference.issueDate) };
    records.push({
      ...base,
      eligible,
      excluded: false,
      manualReview: !eligible,
      duplicate: false,
      errors,
      warnings,
      fields: eligible ? layout.fields : null,
      line: eligible && !configErrors.length ? buildRceLine(layout.fields) : null,
      row
    });
  }

  const eligibleRecords = records.filter((record) => record.eligible);
  const rows = eligibleRecords.map((record) => record.row);
  const blocking = records.filter((record) => !record.eligible && !record.excluded).length;
  return {
    rows,
    validations: records,
    summary: {
      reviewed: records.length,
      eligible: rows.length,
      excluded: records.length - rows.length,
      cancelledExcluded: records.filter((record) => record.excludedReason === "CANCELLED").length,
      duplicatesExcluded: records.filter((record) => record.excludedReason === "DUPLICATE").length,
      blockingErrors: blocking,
      manualReview: records.filter((record) => record.manualReview).length,
      alreadyExported: rows.filter((row) => row.exportStatus === "EXPORTED").length,
      warningCount: records.reduce((sum, record) => sum + record.warnings.length, 0),
      configurationErrors: configErrors,
      readyToExport: configErrors.length === 0 && blocking === 0 && rows.length > 0,
      fileName: config.ruc ? rceFileName({ ruc: config.ruc, period, hasInformation: true, bookCurrency: config.bookCurrency }) : null,
      structureVersion: RCE_STRUCTURE.version,
      igvDestination: config.igvDestination,
      directSubmission: false,
      providerMode: new SireProvider().mode
    }
  };
}

export async function exportSireFile({ period, user }) {
  const preview = await buildSirePreview(period);
  const { summary } = preview;
  if (summary.configurationErrors.length) {
    throw new AppError(422, "SIRE taxpayer configuration is incomplete.", { configurationErrors: summary.configurationErrors }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (summary.blockingErrors > 0) {
    const failures = preview.validations
      .filter((record) => !record.eligible && !record.excluded)
      .map((record) => ({ accountsPayableId: record.accountsPayableId, requestNumber: record.requestNumber, voucher: `${record.row.documentType || "-"} ${record.row.series || "-"}-${record.row.number || "-"}`, errors: record.errors }));
    throw new AppError(422, "Some vouchers failed SIRE validation; fix them before generating the RCE file.", { failures }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!preview.rows.length) throw new AppError(422, "No eligible SIRE/RCE records are available for export.", summary, ERROR_CODES.VALIDATION_ERROR);

  const lines = preview.validations.filter((record) => record.eligible).map((record) => record.line);
  const content = buildRceTxt(lines);
  const fileName = summary.fileName;
  const voucherKeys = [...new Set(preview.rows.map((row) => row.voucherKey))];
  const requestIds = [...new Set(preview.rows.map((row) => row.requestId).filter(Boolean))];
  const requestNumbers = [...new Set(preview.rows.map((row) => row.requestReference).filter(Boolean))];
  const exportSignature = crypto.createHash("sha256").update(`${period}\n${voucherKeys.sort().join("\n")}`).digest("hex");
  // Each export keeps SUNAT's exact file name, so every version lives in its own folder.
  const folder = `${period.replace("-", "")}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const directory = path.join(generatedRoot, "reports", "sire-rce", folder);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, fileName), content, RCE_STRUCTURE.encoding);
    await archiveAsset(path.join(directory, fileName));
  const url = `/generated/reports/sire-rce/${folder}/${fileName}`;
  const history = await GeneratedFile.create({
    // The GeneratedFile kind enum predates the TXT format; the format is recorded in metadata.
    kind: "SIRE_CSV",
    fileName,
    url,
    period,
    requestIds,
    requestNumbers,
    rowCount: lines.length,
    generatedBy: user._id,
    metadata: {
      ...summary,
      format: "SUNAT_RCE_TXT",
      schemaVersion: RCE_STRUCTURE.version,
      voucherKeys,
      accountsPayableIds: preview.rows.map((row) => row.accountsPayableId),
      exportSignature,
      notice: "Preparation/export only. No direct SUNAT submission was performed."
    }
  });
  return { preview, content, fileName, history };
}
