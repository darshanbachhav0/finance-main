import crypto from "node:crypto";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import JournalEntry from "../models/JournalEntry.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { SireProvider } from "../integrations/sire/SireProvider.js";
import { persistReportFile, toCsv } from "./exportService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;

function isoDate(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
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
    voucherId: idOf(voucher),
    voucherKey,
    supplierRuc,
    supplierName: supplierName(payable, request),
    documentType,
    series,
    number,
    invoiceDate: isoDate(voucher?.issueDate || payable.voucher?.documentDate),
    fiscalPeriod: journal?.period || request?.fiscalData?.fiscalPeriod || request?.accountingPeriod || period,
    accountingDate: isoDate(journal?.postedAt || request?.fiscalData?.accountingDate),
    currency,
    subtotal: voucher?.netAmount ?? null,
    igv: voucher?.igvAmount ?? null,
    total: voucher?.xmlAmount ?? payable.originalAmount ?? null,
    exchangeRate: currency === "USD" ? (payable.exchangeRate ?? null) : null,
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
  if (!row.supplierName) warnings.push("Supplier name is missing.");
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
  if (row.currency === "USD" && !(Number(row.exchangeRate) > 0)) errors.push("USD voucher exchange rate is missing.");
  return { errors, warnings };
}

function sireCsvRow(row) {
  return {
    supplierRuc: row.supplierRuc,
    supplierName: row.supplierName,
    documentType: row.documentType,
    series: row.series,
    number: row.number,
    invoiceDate: row.invoiceDate,
    fiscalPeriod: row.fiscalPeriod,
    accountingDate: row.accountingDate,
    currency: row.currency,
    subtotal: row.subtotal,
    igv: row.igv,
    total: row.total,
    exchangeRate: row.exchangeRate,
    requestReference: row.requestReference,
    cxpReference: row.cxpReference
  };
}

export function buildSireCsv(rows) {
  return toCsv(rows.map(sireCsvRow));
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
  return AccountsPayable.find({ $or: conditions })
    .populate({
      path: "request",
      select: "requestNumber accountingPeriod fiscalData supplier supplierSnapshot flowType",
      populate: { path: "supplier", select: "rucDni normalizedIdentifier legalName name" }
    })
    .populate("supplier", "rucDni normalizedIdentifier legalName name")
    .populate("sunatVoucher")
    .populate("provisionJournal", "period postedAt createdAt status")
    .sort({ createdAt: 1, _id: 1 });
}

export async function buildSirePreview(period) {
  if (!PERIOD_PATTERN.test(String(period || ""))) throw new AppError(422, "A valid period is required.", { period }, ERROR_CODES.VALIDATION_ERROR);
  const payables = await candidatePayables(period);
  const payableIds = payables.map((payable) => payable._id);
  const [reverseVouchers, journals, exportedKeys] = await Promise.all([
    payableIds.length ? SunatVoucher.find({ accountsPayable: { $in: payableIds } }).lean() : [],
    payableIds.length ? JournalEntry.find({ accountsPayable: { $in: payableIds }, entryType: "PROVISION", status: { $ne: "VOID" } }).sort({ postedAt: 1, createdAt: 1 }).lean() : [],
    exportedVoucherKeys(period)
  ]);
  const vouchersByPayable = new Map(reverseVouchers.map((voucher) => [idOf(voucher.accountsPayable), voucher]));
  const journalsByPayable = new Map(journals.map((journal) => [idOf(journal.accountsPayable), journal]));
  const seenVoucherKeys = new Set();
  const records = [];

  for (const payable of payables) {
    const request = populated(payable.request);
    const journal = accountingJournal(payable, journalsByPayable);
    const resolvedPeriod = journal?.period || request?.fiscalData?.fiscalPeriod || request?.accountingPeriod;
    if (resolvedPeriod !== period) continue;
    const voucher = populated(payable.sunatVoucher) || vouchersByPayable.get(idOf(payable));
    const row = rowFromPayable({ payable, voucher, journal, period, exportedKeys });
    const validation = validateCandidate(row, voucher);
    let duplicate = false;
    if (row.voucherKey && !row.voucherKey.startsWith("|||")) {
      duplicate = seenVoucherKeys.has(row.voucherKey);
      if (!duplicate) seenVoucherKeys.add(row.voucherKey);
    }
    if (duplicate) validation.errors.push("Duplicate fiscal document candidate was excluded from this SIRE export.");
    const eligible = validation.errors.length === 0;
    if (!eligible) row.exportStatus = "MANUAL_REVIEW";
    records.push({
      id: row.id,
      accountsPayableId: row.accountsPayableId,
      voucherId: row.voucherId,
      voucherKey: row.voucherKey,
      requestId: row.requestId,
      requestNumber: row.requestReference,
      eligible,
      manualReview: !eligible,
      duplicate,
      errors: validation.errors,
      warnings: validation.warnings,
      row
    });
  }

  const rows = records.filter((record) => record.eligible).map((record) => record.row);
  return {
    rows,
    validations: records,
    summary: {
      reviewed: records.length,
      eligible: rows.length,
      excluded: records.length - rows.length,
      manualReview: records.filter((record) => record.manualReview).length,
      alreadyExported: rows.filter((row) => row.exportStatus === "EXPORTED").length,
      warningCount: records.reduce((sum, record) => sum + record.warnings.length, 0),
      directSubmission: false,
      providerMode: new SireProvider().mode
    }
  };
}

export async function exportSireFile({ period, user }) {
  const preview = await buildSirePreview(period);
  if (!preview.rows.length) throw new AppError(422, "No eligible SIRE/RCE records are available for export.", preview.summary, ERROR_CODES.VALIDATION_ERROR);
  const content = buildSireCsv(preview.rows);
  const voucherKeys = [...new Set(preview.rows.map((row) => row.voucherKey))];
  const requestIds = [...new Set(preview.rows.map((row) => row.requestId).filter(Boolean))];
  const requestNumbers = [...new Set(preview.rows.map((row) => row.requestReference).filter(Boolean))];
  const exportSignature = crypto.createHash("sha256").update(`${period}\n${voucherKeys.sort().join("\n")}`).digest("hex");
  const fileName = `sire-rce-${period}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.csv`;
  const url = await persistReportFile(fileName, content);
  const history = await GeneratedFile.create({
    kind: "SIRE_CSV",
    fileName,
    url,
    period,
    requestIds,
    requestNumbers,
    rowCount: preview.rows.length,
    generatedBy: user._id,
    metadata: {
      ...preview.summary,
      schemaVersion: "SIRE_RCE_VOUCHER_V2",
      voucherKeys,
      accountsPayableIds: preview.rows.map((row) => row.accountsPayableId),
      exportSignature,
      notice: "Preparation/export only. No direct SUNAT submission was performed."
    }
  });
  return { preview, content, history };
}
