import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import { SireProvider } from "../integrations/sire/SireProvider.js";
import { persistReportFile, toCsv } from "./exportService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, MANDATORY_XML_TYPES, REQUEST_STATUS } from "../utils/constants.js";

const eligibleStatuses = [
  REQUEST_STATUS.ACCOUNTED,
  REQUEST_STATUS.SCHEDULED,
  REQUEST_STATUS.BANK_FILE_GENERATED,
  REQUEST_STATUS.PAID,
  REQUEST_STATUS.RENDITION_PENDING,
  REQUEST_STATUS.RECONCILED,
  REQUEST_STATUS.CLOSED
];

function validateRequest(request) {
  const errors = [];
  const warnings = [];
  const supplierIdentifier = request.supplierSnapshot?.identifier || request.supplier?.normalizedIdentifier || request.supplier?.rucDni;
  if (!supplierIdentifier) errors.push("Supplier RUC/DNI is missing.");
  if (!request.fiscalData?.voucherType && !request.fiscalData?.documentType) errors.push("Voucher type is missing.");
  if (!request.fiscalData?.series) errors.push("Voucher series is missing.");
  if (!request.fiscalData?.number) errors.push("Voucher number is missing.");
  if (!request.fiscalData?.documentDate) errors.push("Document date is missing.");
  if (!request.fiscalData?.processedAt) errors.push("Fiscal processing is incomplete.");
  if (MANDATORY_XML_TYPES.includes(request.requestType) && !request.xmlValidation?.validated) errors.push("Required XML validation is not valid.");
  if (!request.xmlValidation?.validated) warnings.push("No authoritative XML metadata is attached for cross-checking.");
  return { errors, warnings, eligible: errors.length === 0, supplierIdentifier };
}

function rowFromRequest(request, supplierIdentifier) {
  return {
    period: request.fiscalData?.fiscalPeriod || request.accountingPeriod,
    supplierRucDni: supplierIdentifier,
    supplierName: request.supplierSnapshot?.legalName || request.supplier?.legalName || request.supplier?.name || "",
    voucherType: request.fiscalData?.voucherType || request.fiscalData?.documentType || "",
    series: request.fiscalData?.series || "",
    number: request.fiscalData?.number || "",
    issueDate: request.fiscalData?.documentDate?.toISOString?.().slice(0, 10) || request.xmlValidation?.data?.issueDate || "",
    netAmount: request.totalNet,
    igvAmount: request.totalIGV,
    totalAmount: request.totalAmount,
    currency: request.currency,
    exchangeRate: request.exchangeRate,
    penEquivalent: request.totalPENEquivalent,
    requestNumber: request.requestNumber
  };
}

export async function buildSirePreview(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) throw new AppError(422, "A valid period is required.", { period }, ERROR_CODES.VALIDATION_ERROR);
  const requests = await FinancialRequest.find({ accountingPeriod: period, status: { $in: eligibleStatuses } }).populate("supplier").sort({ issueDate: 1 });
  const records = requests.map((request) => {
    const validation = validateRequest(request);
    return {
      requestId: request._id,
      requestNumber: request.requestNumber,
      ...validation,
      row: validation.eligible ? rowFromRequest(request, validation.supplierIdentifier) : null
    };
  });
  return {
    rows: records.filter((record) => record.eligible).map((record) => record.row),
    validations: records,
    summary: {
      reviewed: records.length,
      eligible: records.filter((record) => record.eligible).length,
      excluded: records.filter((record) => !record.eligible).length,
      warningCount: records.reduce((sum, record) => sum + record.warnings.length, 0),
      directSubmission: false,
      providerMode: new SireProvider().mode
    }
  };
}

export async function exportSireFile({ period, user }) {
  const preview = await buildSirePreview(period);
  if (!preview.rows.length) throw new AppError(422, "No eligible SIRE/RCE records are available for export.", preview.summary, ERROR_CODES.VALIDATION_ERROR);
  const content = toCsv(preview.rows);
  const fileName = `sire-rce-${period}-${Date.now()}.csv`;
  const url = await persistReportFile(fileName, content);
  const history = await GeneratedFile.create({
    kind: "SIRE_CSV",
    fileName,
    url,
    period,
    requestNumbers: preview.rows.map((row) => row.requestNumber),
    rowCount: preview.rows.length,
    generatedBy: user._id,
    metadata: { ...preview.summary, notice: "Preparation/export only. No direct SUNAT submission was performed." }
  });
  return { preview, content, history };
}

