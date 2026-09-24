import SunatVoucher from "../models/SunatVoucher.js";
import { sunatService } from "./sunatService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

export function splitVoucherNumber(invoiceNumber = "") {
  const normalized = String(invoiceNumber || "").trim().toUpperCase().replace(/\s+/g, "");
  const parts = normalized.split("-");
  return { series: parts.shift() || "", number: parts.join("-") || "" };
}

export function voucherIdentity({ ruc, voucherType = "FACTURA", series, number, invoiceNumber }) {
  const split = splitVoucherNumber(invoiceNumber);
  return {
    rucIssuer: String(ruc || "").replace(/\D/g, ""),
    voucherType: String(voucherType || "FACTURA").trim().toUpperCase(),
    series: String(series || split.series || "").trim().toUpperCase(),
    number: String(number || split.number || "").trim().toUpperCase()
  };
}

export async function findDuplicateVoucher(voucher, { session } = {}) {
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) return null;
  return SunatVoucher.findOne({
    rucIssuer: identity.rucIssuer,
    voucherType: identity.voucherType,
    seriesNumber: `${identity.series}-${identity.number}`
  }).session(session || null);
}

export async function validateVoucherWithSunat(voucher, { request, user, manualDecision } = {}) {
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) {
    return { valid: false, status: "INVALID_IDENTITY", detail: "RUC, series and voucher number are required." };
  }
  const context = manualDecision ? { authorizedDecision: true, valid: Boolean(manualDecision.valid), comments: manualDecision.comments, user } : { request, user };
  const taxpayer = await sunatService.validateTaxpayer(identity.rucIssuer, context);
  if (!taxpayer?.valid) return { valid: false, status: taxpayer?.status || taxpayer?.taxpayerStatus || "RUC_NO_HABIDO", taxpayer, detail: "SUNAT taxpayer validation failed or issuer is not HABIDO/active." };
  const fiscal = await sunatService.validateVoucher({ ...voucher, ruc: identity.rucIssuer, ...identity }, context);
  if (!fiscal?.valid || fiscal.voucherVerified === false || fiscal.publicDataset || (process.env.NODE_ENV === "production" && fiscal.source === "MOCK")) return { valid: false, status: fiscal?.status || "COMPROBANTE_NO_VERIFICADO", taxpayer, fiscal, detail: "The supplier check does not verify this invoice. Individual voucher validation is required before accounting." };
  return { valid: true, status: fiscal?.status || "ACEPTADO", taxpayer, fiscal };
}

export async function createSunatVoucher({ request, purchaseOrder, batch, supplier, voucher, flowType, validationStatus, observationDetail, sunatResult, xmlFile, pdfFile, user, session }) {
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) throw new AppError(422, "Voucher identity is incomplete.", { identity }, ERROR_CODES.VALIDATION_ERROR);
  const [created] = await SunatVoucher.create([{
    request: request._id,
    purchaseOrder: purchaseOrder?._id || purchaseOrder,
    batch: batch?._id || batch,
    flowType: flowType || request.flowType,
    supplier: supplier?._id || supplier || request.supplier?._id || request.supplier,
    ...identity,
    issueDate: voucher.issueDate,
    currency: voucher.currency || request.currency,
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    xmlAmount: voucher.totalAmount,
    validationStatus,
    observationDetail,
    sunatStatus: sunatResult?.status || sunatResult?.fiscal?.status,
    taxpayerStatus: sunatResult?.taxpayer?.condition || sunatResult?.taxpayer?.status,
    sunatProvider: sunatResult?.fiscal?.source || sunatResult?.taxpayer?.source,
    validationEvidence: sunatResult,
    xmlPath: xmlFile?.path,
    xmlUrl: xmlFile?.url,
    pdfPath: pdfFile?.path,
    pdfUrl: pdfFile?.url,
    xmlChecksum: xmlFile?.checksum,
    validatedAt: new Date(),
    validatedBy: user?._id || user
  }], session ? { session } : undefined);
  return created;
}

/**
 * Records a dedicated, human-triggered manual SUNAT-validation override on a single voucher.
 *
 * This is deliberately NOT part of the automatic validation path (see getSunatProvider() in
 * sunatService.js and ManualSunatProvider): it never runs automatically and never silently
 * substitutes for authoritative SUNAT validation. It is invoked only via the dedicated
 * manual-sunat-override action (Admin/Accounting only), requires a mandatory reason and evidence
 * reference, marks the voucher with the explicit non-authoritative MANUAL_EXCEPTION status
 * (never VALID), and records the full decision in the audit log via recordAudit().
 */
export async function applyManualSunatOverride({ request, voucherId, reason, evidenceReference, user, req, session } = {}) {
  const reasonText = String(reason || "").trim();
  const evidenceText = String(evidenceReference || "").trim();
  if (!reasonText) {
    throw new AppError(422, "A reason is required to record a manual SUNAT validation override.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!evidenceText) {
    throw new AppError(422, "An evidence reference is required to record a manual SUNAT validation override.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!request?._id) {
    throw new AppError(404, "Financial request not found.", undefined, ERROR_CODES.NOT_FOUND);
  }
  const voucher = await SunatVoucher.findOne({ _id: voucherId, request: request._id }).session(session || null);
  if (!voucher) {
    throw new AppError(404, "SUNAT voucher was not found for this request.", { voucherId }, ERROR_CODES.NOT_FOUND);
  }
  if (voucher.validationStatus === "VALID") {
    throw new AppError(409, "This voucher already passed automated SUNAT validation; a manual override is not applicable.", { voucherId }, ERROR_CODES.CONFLICT);
  }
  const previousValidationStatus = voucher.validationStatus;
  voucher.validationStatus = "MANUAL_EXCEPTION";
  voucher.observationDetail = `Manual SUNAT validation exception: ${reasonText}`;
  voucher.manualOverride = {
    reason: reasonText,
    evidenceReference: evidenceText,
    overriddenBy: user?._id || user,
    overriddenAt: new Date(),
    previousValidationStatus
  };
  await voucher.save({ session });

  await recordAudit({
    entityType: "SunatVoucher",
    entity: voucher,
    requestId: request._id,
    action: "MANUAL_SUNAT_OVERRIDE",
    user,
    req,
    module: "ACCOUNTING",
    comments: reasonText,
    oldValues: { validationStatus: previousValidationStatus },
    newValues: { validationStatus: "MANUAL_EXCEPTION", reason: reasonText, evidenceReference: evidenceText },
    session
  });

  return voucher;
}
