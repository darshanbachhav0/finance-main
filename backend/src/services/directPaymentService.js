import { assertVoucherXmlMatches } from "./xmlValidationService.js";
import { assertPostingAllowed } from "./financialProgressService.js";
import Supplier from "../models/Supplier.js";
import SunatVoucher from "../models/SunatVoucher.js";
import User from "../models/User.js";
import { createAccountsPayableFromVoucher } from "./accountingService.js";
import { reserveBudget, executeBudget } from "./budgetService.js";
import { getVerifiedEmployeeReimbursementBankAccount } from "./employeeReimbursementBankService.js";
import { createSunatVoucher, findDuplicateVoucher, splitVoucherNumber, validateVoucherWithSunat } from "./sunatVoucherService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE, REQUEST_STATUS } from "../utils/constants.js";

function xmlVoucher(request) {
  const data = request.xmlValidation?.data || {};
  const identity = splitVoucherNumber(data.invoiceNumber || `${request.fiscalData?.series || ""}-${request.fiscalData?.number || ""}`);
  return {
    ruc: data.ruc || request.supplierSnapshot?.identifier,
    voucherType: request.fiscalData?.voucherType || request.fiscalData?.documentType || "FACTURA",
    series: request.fiscalData?.series || identity.series,
    number: request.fiscalData?.number || identity.number,
    issueDate: data.issueDate || request.fiscalData?.documentDate || request.issueDate,
    currency: data.currency || request.currency,
    netAmount: data.netAmount ?? request.totalNet,
    igvAmount: data.igvAmount ?? request.totalIGV,
    totalAmount: data.totalAmount ?? request.totalAmount
  };
}

function latestAttachment(request, kind) {
  return [...(request.attachments || [])].reverse().find((item) => item.kind === kind);
}

function sameObservedRequestVoucher(duplicate, request) {
  return Boolean(
    duplicate
    && String(duplicate.request) === String(request._id)
    && !duplicate.accountsPayable
    && duplicate.validationStatus !== "VALID"
  );
}

async function observeDirectPayment({ request, user, req, detail, code = ERROR_CODES.XML_VALIDATION_FAILED }) {
  request.observation = {
    code,
    detail,
    observedAt: new Date(),
    observedBy: user._id,
    resolvedAt: undefined,
    resolvedBy: undefined
  };
  await transitionRequest({
    request,
    targetStatus: REQUEST_STATUS.OBSERVED_SUNAT,
    user,
    req,
    action: "DIRECT_PAYMENT_OBSERVED",
    comments: detail,
    skipControls: true
  });
}

async function saveObservedDirectPaymentVoucher({ request, supplier, voucher, detail, code, sunatResult, user, placeholder }) {
  const xmlFile = latestAttachment(request, "XML");
  const pdfFile = latestAttachment(request, "PDF");
  if (!placeholder) {
    return createSunatVoucher({
      request,
      supplier,
      voucher,
      flowType: FLOW_TYPE.B,
      validationStatus: "OBSERVED_SUNAT",
      observationDetail: detail,
      sunatResult,
      xmlFile,
      pdfFile,
      user
    });
  }
  const identity = splitVoucherNumber(`${voucher.series || ""}-${voucher.number || ""}`);
  placeholder.rucIssuer = String(voucher.ruc || "").replace(/\D/g, "");
  placeholder.voucherType = String(voucher.voucherType || "FACTURA").trim().toUpperCase();
  placeholder.series = String(voucher.series || identity.series || "").trim().toUpperCase();
  placeholder.number = String(voucher.number || identity.number || "").trim().toUpperCase();
  placeholder.seriesNumber = `${placeholder.series}-${placeholder.number}`;
  placeholder.issueDate = voucher.issueDate;
  placeholder.currency = voucher.currency || request.currency;
  placeholder.netAmount = voucher.netAmount;
  placeholder.igvAmount = voucher.igvAmount;
  placeholder.xmlAmount = voucher.totalAmount;
  placeholder.validationStatus = "OBSERVED_SUNAT";
  placeholder.observationDetail = detail;
  placeholder.sunatStatus = sunatResult?.status || code;
  placeholder.taxpayerStatus = sunatResult?.taxpayer?.condition || sunatResult?.taxpayer?.status;
  placeholder.sunatProvider = sunatResult?.fiscal?.source || sunatResult?.taxpayer?.source;
  placeholder.xmlPath = xmlFile?.path;
  placeholder.xmlUrl = xmlFile?.url;
  placeholder.xmlChecksum = xmlFile?.checksum;
  placeholder.pdfPath = pdfFile?.path;
  placeholder.pdfUrl = pdfFile?.url;
  placeholder.validatedAt = new Date();
  placeholder.validatedBy = user._id;
  await placeholder.save();
  return placeholder;
}

/**
 * Performs the fiscal controls for Track B before any budget balance is moved.
 * A failed invoice is registered as an observed SUNAT voucher, but no budget
 * commitment or CXP is created.
 */
export async function preflightDirectPayment({ request, user, req, observe = true }) {
  if (request.flowType !== FLOW_TYPE.B) {
    throw new AppError(422, "Direct-payment preflight is only available for Track B.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!request.xmlValidation?.validated) {
    throw new AppError(422, "Track B requires a validated invoice XML.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const voucher = xmlVoucher(request);
  await assertVoucherXmlMatches(latestAttachment(request, "XML")?.path, {
    ...voucher, currency: request.currency, netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount
  });
  const supplier = request.supplier?._id ? request.supplier : await Supplier.findById(request.supplier);
  const duplicate = await findDuplicateVoucher(voucher);
  const placeholder = sameObservedRequestVoucher(duplicate, request) ? duplicate : null;
  if (duplicate && !placeholder) {
    const detail = "RUC + voucher type + series + number already exists in the system.";
    if (observe) await observeDirectPayment({ request, user, req, detail, code: ERROR_CODES.DUPLICATE_VOUCHER });
    return { valid: false, duplicate, voucher, detail, code: ERROR_CODES.DUPLICATE_VOUCHER };
  }

  let sunatResult;
  try {
    sunatResult = await validateVoucherWithSunat(voucher, { request, user });
  } catch (error) {
    const detail = error.code === ERROR_CODES.INTEGRATION_NOT_CONFIGURED
      ? "Automated SUNAT validation is not configured. Configure the production gateway before approving Track B."
      : error.message;
    let observedVoucher = placeholder;
    if (observe) {
      observedVoucher = await saveObservedDirectPaymentVoucher({ request, supplier, voucher, detail, code: error.code, user, placeholder });
      await observeDirectPayment({ request, user, req, detail, code: error.code || ERROR_CODES.XML_VALIDATION_FAILED });
    }
    return { valid: false, voucher, detail, code: error.code || ERROR_CODES.XML_VALIDATION_FAILED, integrationError: error, placeholder: observedVoucher };
  }
  if (!sunatResult.valid) {
    const detail = sunatResult.detail || "SUNAT rejected the invoice or the issuer is not HABIDO.";
    let observedVoucher = placeholder;
    if (observe) {
      observedVoucher = await saveObservedDirectPaymentVoucher({ request, supplier, voucher, detail, code: sunatResult.status, sunatResult, user, placeholder });
      await observeDirectPayment({ request, user, req, detail, code: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED });
    }
    return { valid: false, voucher, sunatResult, detail, code: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED, placeholder: observedVoucher };
  }
  return { valid: true, voucher, sunatResult, placeholder };
}

export async function provisionDirectPayment({ request, user, req, session, preflight }) {
  await assertPostingAllowed(request, { user, req });
  if (request.flowType !== FLOW_TYPE.B) throw new AppError(422, "Direct-payment provisioning is only available for Track B.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) throw new AppError(409, "Track B can be provisioned only after approval and budget commitment.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const checked = preflight || await preflightDirectPayment({ request, user, req, observe: false });
  if (!checked.valid) {
    throw new AppError(409, checked.detail || "Track B fiscal validation failed.", { code: checked.code }, checked.code || ERROR_CODES.XML_VALIDATION_FAILED);
  }

  const supplier = request.supplier?._id ? request.supplier : await Supplier.findById(request.supplier).session(session || null);
  const { voucher, sunatResult } = checked;
  const duplicate = await findDuplicateVoucher(voucher, { session });
  const reusable = sameObservedRequestVoucher(duplicate, request) ? duplicate : null;
  if (duplicate && !reusable) throw new AppError(409, "This fiscal voucher already exists in the system.", { voucher: duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);

  const xmlAttachment = latestAttachment(request, "XML");
  const pdfAttachment = latestAttachment(request, "PDF");
  let sunatVoucher = reusable ? await SunatVoucher.findById(reusable._id).session(session || null) : null;
  if (sunatVoucher) {
    const identity = splitVoucherNumber(`${voucher.series || ""}-${voucher.number || ""}`);
    sunatVoucher.set({
      rucIssuer: String(voucher.ruc || "").replace(/\D/g, ""),
      voucherType: String(voucher.voucherType || "FACTURA").trim().toUpperCase(),
      series: String(voucher.series || identity.series || "").trim().toUpperCase(),
      number: String(voucher.number || identity.number || "").trim().toUpperCase(),
      seriesNumber: `${String(voucher.series || identity.series || "").trim().toUpperCase()}-${String(voucher.number || identity.number || "").trim().toUpperCase()}`,
      issueDate: voucher.issueDate,
      currency: voucher.currency || request.currency,
      netAmount: voucher.netAmount,
      igvAmount: voucher.igvAmount,
      xmlAmount: voucher.totalAmount,
      validationStatus: "VALID",
      observationDetail: "",
      sunatStatus: sunatResult?.status || sunatResult?.fiscal?.status,
      taxpayerStatus: sunatResult?.taxpayer?.condition || sunatResult?.taxpayer?.status,
      sunatProvider: sunatResult?.fiscal?.source || sunatResult?.taxpayer?.source,
      xmlPath: xmlAttachment?.path,
      xmlUrl: xmlAttachment?.url,
      xmlChecksum: xmlAttachment?.checksum,
      pdfPath: pdfAttachment?.path,
      pdfUrl: pdfAttachment?.url,
      validatedAt: new Date(),
      validatedBy: user._id
    });
    await sunatVoucher.save({ session });
  } else {
    sunatVoucher = await createSunatVoucher({ request, supplier, voucher, flowType: FLOW_TYPE.B, validationStatus: "VALID", sunatResult, xmlFile: xmlAttachment, pdfFile: pdfAttachment, user, session });
  }

  const accountsPayable = await createAccountsPayableFromVoucher({
    request,
    supplier,
    voucher,
    sunatVoucher,
    user,
    paymentPriority: "PRIORITY",
    dueDate: new Date(),
    session
  });
  sunatVoucher.accountsPayable = accountsPayable._id;
  sunatVoucher.provisionedAt = new Date();
  await sunatVoucher.save({ session });

  request.fiscalData = {
    supplierIdentifierNormalized: String(voucher.ruc || "").replace(/\D/g, ""),
    voucherType: voucher.voucherType,
    documentType: voucher.voucherType,
    series: voucher.series,
    number: voucher.number,
    documentDate: voucher.issueDate,
    accountingDate: new Date(),
    fiscalPeriod: request.accountingPeriod,
    comments: "Track B automatically provisioned after SUNAT validation.",
    processedAt: new Date(),
    processedBy: user._id
  };
  request.directPayment = {
    express: true,
    xmlLocked: true,
    immutableAmounts: {
      netAmount: voucher.netAmount,
      igvAmount: voucher.igvAmount,
      totalAmount: voucher.totalAmount,
      currency: voucher.currency
    },
    provisionedAt: new Date(),
    provisionedBy: user._id
  };
  request.observation = undefined;
  await executeBudget(request, user._id, { session, comments: "Track B budget executed at automatic CXP provision." });
  accountsPayable.budgetExecutedAt = new Date();
  await accountsPayable.save({ session });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.ACCOUNTED, user, req, action: "DIRECT_PAYMENT_PROVISIONED", comments: "Track B invoice validated with SUNAT and automatically provisioned to CXP.", session });
  return { observed: false, sunatVoucher, accountsPayable };
}

export async function provisionTrackCAdvance({ request, user, req, session }) {
  await assertPostingAllowed(request, { user, req });
  if (request.flowType !== FLOW_TYPE.C) throw new AppError(422, "Advance provisioning is only available for Track C.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  if (![REQUEST_STATUS.APPROVED, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.OBSERVED_BUDGET].includes(request.status)) throw new AppError(409, "Track C can be provisioned only after all approvals are complete or after a budget observation is resolved.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const requester = await User.findById(request.requester?._id || request.requester || request.solicitor).session(session || null);
  if (!requester?.active || !/^\d{8}$/.test(requester.dni || "")) throw new AppError(422, "An active employee with a valid DNI is required for an advance payment.");
  const bank = await getVerifiedEmployeeReimbursementBankAccount({ userId: requester._id, currency: request.currency, session });
  if (!bank) throw new AppError(422, "Track C requires a verified employee bank account before the advance can be released.", undefined, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);

  request.rendition ||= {};
  request.rendition.beneficiarySnapshot = {
    user: requester._id,
    employeeCode: requester.employeeCode,
    name: requester.name,
    email: requester.email,
    area: requester.area,
    costCenter: request.requesterCostCenter
  };
  request.rendition.reimbursementBankSnapshot = {
    profile: bank._id,
    bank: bank.bank,
    currency: bank.currency,
    accountHolderName: bank.accountHolderName,
    accountNumber: bank.accountNumber,
    cci: bank.cci,
    verificationStatus: bank.verificationStatus,
    capturedAt: new Date()
  };
  const commitment = await reserveBudget(request, user._id, { session });
  request.budgetCommitment = commitment._id;
  const voucher = {
    ruc: requester.dni,
    voucherType: "ANTICIPO",
    series: "UMA",
    number: request.requestNumber,
    issueDate: new Date(),
    currency: request.currency,
    netAmount: request.totalAmount,
    igvAmount: 0,
    totalAmount: request.totalAmount
  };
  const accountsPayable = await createAccountsPayableFromVoucher({ request, voucher, user, paymentPriority: "PRIORITY", dueDate: new Date(), session });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.ACCOUNTED, user, req, action: "ADVANCE_PROVISIONED", comments: "Track C budget reserved before the advance is posted to Account 14; expense execution remains deferred until rendition validation.", session, skipControls: true });
  return { accountsPayable, commitment };
}
