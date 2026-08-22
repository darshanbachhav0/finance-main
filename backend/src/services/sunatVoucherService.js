import SunatVoucher from "../models/SunatVoucher.js";
import { sunatService } from "./sunatService.js";
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
  if (!fiscal?.valid) return { valid: false, status: fiscal?.status || "COMPROBANTE_INVALIDO", taxpayer, fiscal, detail: "SUNAT voucher validation failed or voucher is not ACEPTADO." };
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
