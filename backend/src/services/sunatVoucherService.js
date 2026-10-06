import SunatVoucher from "../models/SunatVoucher.js";
import Supplier from "../models/Supplier.js";
import { sunatService } from "./sunatService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import {
  canonicalSeries,
  canonicalVoucherNumber,
  canonicalVoucherType,
  seriesNumberPattern,
  sunatDocumentTypeCode,
  voucherTypeVariants
} from "../utils/voucherIdentity.js";

export function splitVoucherNumber(invoiceNumber = "") {
  const normalized = String(invoiceNumber || "").trim().toUpperCase().replace(/\s+/g, "");
  const parts = normalized.split("-");
  const series = parts.shift() || "";
  const number = parts.join("-") || "";
  return { series, number: number ? canonicalVoucherNumber(number) : "" };
}

// Canonical identity: RUC digits, Tabla 10 document type mapped to its internal name, upper-case
// series and the correlative without leading zeros (F001-00001234 === F001-1234, "01" === FACTURA).
export function voucherIdentity({ ruc, rucIssuer, voucherType = "FACTURA", documentType, series, number, invoiceNumber }) {
  const split = splitVoucherNumber(invoiceNumber);
  const type = canonicalVoucherType(voucherType || documentType);
  return {
    rucIssuer: String(ruc || rucIssuer || "").replace(/\D/g, ""),
    voucherType: type,
    documentTypeCode: sunatDocumentTypeCode(type),
    series: canonicalSeries(series || split.series || ""),
    number: canonicalVoucherNumber(number || split.number || "")
  };
}

function duplicateFilter(identity) {
  return {
    rucIssuer: identity.rucIssuer,
    voucherType: { $in: voucherTypeVariants(identity.voucherType) },
    seriesNumber: seriesNumberPattern(identity.series, identity.number)
  };
}

// Annulled evidence (from a cancelled CXP) never blocks a new registration of the same voucher.
export async function findDuplicateVoucher(voucher, { session, includeAnnulled = false } = {}) {
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) return null;
  const filter = duplicateFilter(identity);
  if (!includeAnnulled) filter.validationStatus = { $ne: "ANNULLED" };
  return SunatVoucher.findOne(filter).session(session || null);
}

export async function validateVoucherWithSunat(voucher, { request, user, manualDecision } = {}) {
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) {
    return { valid: false, status: "INVALID_IDENTITY", detail: "RUC, series and voucher number are required." };
  }
  // An exception Accounting already approved on this request's stored voucher replaces the SUNAT
  // voucher check on every path (A1, A2, Track B, manual processing) so the invoice can post.
  if (request?._id && !manualDecision) {
    const stored = await SunatVoucher.findOne({ ...duplicateFilter(identity), request: request._id, validationStatus: { $ne: "ANNULLED" } }).lean();
    if (hasManualSunatException(stored)) return manualExceptionEvidence(stored);
  }
  const context = manualDecision ? { authorizedDecision: true, valid: Boolean(manualDecision.valid), comments: manualDecision.comments, user } : { request, user };
  const taxpayer = await sunatService.validateTaxpayer(identity.rucIssuer, context);
  if (!taxpayer?.valid) return { valid: false, status: taxpayer?.status || taxpayer?.taxpayerStatus || "RUC_NO_HABIDO", taxpayer, detail: "SUNAT taxpayer validation failed or issuer is not HABIDO/active." };
  const fiscal = await sunatService.validateVoucher({ ...voucher, ruc: identity.rucIssuer, ...identity }, context);
  if (!fiscal?.valid || fiscal.voucherVerified === false || fiscal.publicDataset || (process.env.NODE_ENV === "production" && fiscal.source === "MOCK")) return { valid: false, status: fiscal?.status || "COMPROBANTE_NO_VERIFICADO", taxpayer, fiscal, detail: "The supplier check does not verify this invoice. Individual voucher validation is required before accounting. When SUNAT is unavailable or only the Padrón is configured, Accounting can approve a manual SUNAT exception." };
  return { valid: true, status: fiscal?.status || "ACEPTADO", taxpayer, fiscal };
}

// True when Accounting approved a manual SUNAT exception on this voucher evidence.
// (A provisioning path outside Accounting may later relabel the status VALID; the audited
// manualOverride record is what proves the exception.)
export function hasManualSunatException(voucher) {
  return Boolean(voucher && ["MANUAL_EXCEPTION", "VALID"].includes(voucher.validationStatus) && voucher.manualOverride?.overriddenAt && voucher.manualOverride?.reason);
}

// Validation evidence recorded for a voucher accepted through the manual exception. It is explicitly
// flagged as non-authoritative (manualException, voucherVerified false) and is accepted for posting
// only when the voucher itself carries the audited MANUAL_EXCEPTION decision.
export function manualExceptionEvidence(voucher) {
  const override = voucher.manualOverride || {};
  return {
    valid: true,
    status: "MANUAL_EXCEPTION",
    manualException: true,
    detail: `Manual SUNAT exception approved by Accounting: ${override.reason}`,
    taxpayer: voucher.validationEvidence?.taxpayer,
    fiscal: {
      valid: true,
      source: "MANUAL_EXCEPTION",
      manualException: true,
      authoritative: false,
      voucherVerified: false,
      reason: override.reason,
      evidenceReference: override.evidenceReference,
      approvedBy: override.overriddenBy,
      approvedAt: override.overriddenAt,
      taxpayerUnverified: Boolean(override.taxpayerUnverified)
    }
  };
}

function voucherFields({ request, purchaseOrder, batch, supplier, voucher, flowType, validationStatus, observationDetail, sunatResult, xmlFile, pdfFile, user }) {
  const identity = voucherIdentity(voucher);
  return {
    request: request._id,
    purchaseOrder: purchaseOrder?._id || purchaseOrder,
    batch: batch?._id || batch,
    flowType: flowType || request.flowType,
    supplier: supplier?._id || supplier || request.supplier?._id || request.supplier,
    ...identity,
    seriesNumber: `${identity.series}-${identity.number}`,
    issueDate: voucher.issueDate,
    currency: voucher.currency || request.currency,
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    xmlAmount: voucher.totalAmount,
    referenceVoucherType: voucher.reference?.voucherType ? canonicalVoucherType(voucher.reference.voucherType) : undefined,
    referenceSeriesNumber: voucher.reference?.seriesNumber,
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
    pdfChecksum: pdfFile?.checksum,
    evidenceSource: xmlFile?.path ? "XML" : pdfFile?.path ? "PDF" : undefined,
    validatedAt: new Date(),
    validatedBy: user?._id || user
  };
}

export async function createSunatVoucher(args) {
  const { voucher, session } = args;
  const identity = voucherIdentity(voucher);
  if (!identity.rucIssuer || !identity.series || !identity.number) throw new AppError(422, "Voucher identity is incomplete.", { identity }, ERROR_CODES.VALIDATION_ERROR);
  const fields = voucherFields(args);
  // A voucher whose CXP was cancelled is recycled: its previous state is archived so the unique
  // RUC + type + series-number identity can back the corrected registration.
  const annulled = await SunatVoucher.findOne({ ...duplicateFilter(identity), validationStatus: "ANNULLED" }).select("+xmlPath +pdfPath").session(session || null);
  if (annulled) {
    annulled.annulmentHistory.push({
      request: annulled.request,
      accountsPayable: annulled.accountsPayable,
      annulment: annulled.annulment,
      xmlChecksum: annulled.xmlChecksum,
      xmlAmount: annulled.xmlAmount,
      archivedAt: new Date()
    });
    annulled.set({ ...fields, accountsPayable: undefined, provisionedAt: undefined, annulment: undefined, manualOverride: undefined, supersededBy: undefined, supersededAt: undefined });
    await annulled.save({ session });
    return annulled;
  }
  const [created] = await SunatVoucher.create([fields], session ? { session } : undefined);
  return created;
}

async function assertManualExceptionEligible(voucher, request, user) {
  const supplierId = request.supplier?._id || request.supplier || voucher.supplier;
  const supplier = request.supplier?.normalizedIdentifier || request.supplier?.rucDni ? request.supplier : await Supplier.findById(supplierId).select("normalizedIdentifier rucDni").lean();
  const expectedRuc = String(supplier?.normalizedIdentifier || supplier?.rucDni || "").replace(/\D/g, "");
  if (expectedRuc && voucher.rucIssuer !== expectedRuc) {
    throw new AppError(422, "The voucher issuer RUC does not match the request supplier. A manual SUNAT exception cannot correct a supplier mismatch.", { rucIssuer: voucher.rucIssuer, expectedRuc }, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  // SUNAT down / padrón unavailable is exactly the case the exception exists for, so an unreachable
  // taxpayer service is recorded rather than blocking. An explicit negative answer still blocks.
  try {
    const taxpayer = await sunatService.validateTaxpayer(voucher.rucIssuer, { request, user });
    if (taxpayer && taxpayer.valid === false) {
      throw new AppError(422, "SUNAT reports that the issuer is not an active/HABIDO taxpayer. A manual SUNAT exception only covers an unavailable voucher validation.", { taxpayer }, ERROR_CODES.XML_VALIDATION_FAILED);
    }
    return { taxpayer, taxpayerUnverified: false };
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.XML_VALIDATION_FAILED) throw error;
    return { taxpayer: undefined, taxpayerUnverified: true, taxpayerError: error.message };
  }
}

/**
 * Records Accounting's manual SUNAT exception on a single voucher.
 *
 * Used when SUNAT cannot validate the individual voucher (SUNAT is down, or the platform runs in
 * PADRON-only mode, which can never verify a CPE). One Accounting (or Admin) user is enough; a
 * reason is mandatory, the evidence reference is optional. The voucher is marked with the explicit
 * non-authoritative MANUAL_EXCEPTION status (never VALID) and the decision is written to the audit
 * log. A MANUAL_EXCEPTION voucher can then be posted, provisioned to CXP and paid. It never runs
 * automatically, and it cannot bypass a supplier mismatch, a duplicate, a PO ceiling or a negative
 * taxpayer answer.
 */
export async function applyManualSunatOverride({ request, voucherId, reason, evidenceReference, user, req, session } = {}) {
  const reasonText = String(reason || "").trim();
  const evidenceText = String(evidenceReference || "").trim();
  if (!reasonText) {
    throw new AppError(422, "A reason is required to record a manual SUNAT exception.", { field: "reason" }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!request?._id) {
    throw new AppError(404, "Financial request not found.", undefined, ERROR_CODES.NOT_FOUND);
  }
  const voucher = await SunatVoucher.findOne({ _id: voucherId, request: request._id }).session(session || null);
  if (!voucher) {
    throw new AppError(404, "SUNAT voucher was not found for this request.", { voucherId }, ERROR_CODES.NOT_FOUND);
  }
  if (hasManualSunatException(voucher)) return voucher;
  if (voucher.validationStatus === "VALID") {
    throw new AppError(409, "This voucher already passed automated SUNAT validation; a manual exception is not applicable.", { voucherId }, ERROR_CODES.CONFLICT);
  }
  if (!["OBSERVED_SUNAT", "PENDING"].includes(voucher.validationStatus) || voucher.supersededBy) {
    throw new AppError(409, "A manual SUNAT exception only applies to a voucher observed because SUNAT could not validate it.", { validationStatus: voucher.validationStatus }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const eligibility = await assertManualExceptionEligible(voucher, request, user);
  const previousValidationStatus = voucher.validationStatus;
  voucher.validationStatus = "MANUAL_EXCEPTION";
  voucher.observationDetail = `Manual SUNAT exception: ${reasonText}`;
  voucher.manualOverride = {
    reason: reasonText,
    evidenceReference: evidenceText,
    overriddenBy: user?._id || user,
    overriddenAt: new Date(),
    previousValidationStatus,
    taxpayerUnverified: eligibility.taxpayerUnverified
  };
  voucher.validationEvidence = { ...manualExceptionEvidence(voucher), taxpayer: eligibility.taxpayer };
  voucher.sunatStatus = "MANUAL_EXCEPTION";
  voucher.sunatProvider = "MANUAL_EXCEPTION";
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
    newValues: { validationStatus: "MANUAL_EXCEPTION", reason: reasonText, evidenceReference: evidenceText, taxpayerUnverified: eligibility.taxpayerUnverified, taxpayerError: eligibility.taxpayerError },
    session
  });

  return voucher;
}
