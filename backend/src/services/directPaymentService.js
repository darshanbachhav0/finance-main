import { assertVoucherEvidenceMatches, latestInvoiceEvidence } from "./xmlValidationService.js";
import { advancePaymentDateKey } from "./advancePaymentService.js";
import { assertPostingAllowed } from "./financialProgressService.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { createAccountsPayableFromVoucher } from "./accountingService.js";
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
    voucherType: request.fiscalData?.voucherType || request.fiscalData?.documentType || data.voucherType || "FACTURA",
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

async function observeDirectPayment({ request, user, req, detail, code = ERROR_CODES.XML_VALIDATION_FAILED, resolver = "REQUESTER" }) {
  request.observation = {
    code,
    detail,
    resolver,
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
    skipControls: true,
    skipRoleCheck: true
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
    throw new AppError(422, "Track B requires a verified invoice (its XML or factura PDF).", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const voucher = xmlVoucher(request);
  await assertVoucherEvidenceMatches(latestInvoiceEvidence(request.attachments)?.path, {
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
      // SUNAT could not be reached or is not configured: Accounting decides, not the requester.
      await observeDirectPayment({ request, user, req, detail, code: error.code || ERROR_CODES.XML_VALIDATION_FAILED, resolver: "ACCOUNTING" });
    }
    return { valid: false, voucher, detail, code: error.code || ERROR_CODES.XML_VALIDATION_FAILED, integrationError: error, placeholder: observedVoucher, resolver: "ACCOUNTING" };
  }
  if (!sunatResult.valid) {
    const detail = sunatResult.detail || "SUNAT rejected the invoice or the issuer is not HABIDO.";
    // The supplier is a valid taxpayer but the invoice itself could not be verified: a manual
    // SUNAT exception (Accounting) is the only resolution. A rejected taxpayer stays with the requester.
    const resolver = sunatResult.taxpayer?.valid && sunatResult.fiscal ? "ACCOUNTING" : "REQUESTER";
    let observedVoucher = placeholder;
    if (observe) {
      observedVoucher = await saveObservedDirectPaymentVoucher({ request, supplier, voucher, detail, code: sunatResult.status, sunatResult, user, placeholder });
      await observeDirectPayment({ request, user, req, detail, code: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED, resolver });
    }
    return { valid: false, voucher, sunatResult, detail, code: sunatResult.status || ERROR_CODES.XML_VALIDATION_FAILED, placeholder: observedVoucher, resolver };
  }
  return { valid: true, voucher, sunatResult, placeholder };
}

// Legacy direct posting is deliberately disabled. The former implementation created
// journal entries at the final approver's action, bypassing Contabilidad and the acta.
// Existing callers must use processAccountsPayable (Accounting permission required).
export async function provisionDirectPayment() {
  throw new AppError(409, "Track B requires Contabilidad review and a signed acta. Use the Accounting provision workflow.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);
}

// automatic: run as the consequence of the final approval (or of the employee's bank account
// being verified), so the role of whoever triggered it does not authorize the step.
export async function provisionTrackCAdvance({ request, user, req, session, automatic = false }) {
  await assertPostingAllowed(request, { user, req });
  if (request.flowType !== FLOW_TYPE.C) throw new AppError(422, "Advance provisioning is only available for Track C.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED || !request.budgetCommitment) throw new AppError(409, "The Track C advance must have an approved budget commitment before Accounting provisions it.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const requester = await User.findById(request.requester?._id || request.requester || request.solicitor).session(session || null);
  if (!requester?.active || !/^\d{8}$/.test(requester.dni || "")) throw new AppError(422, "An active employee with a valid DNI is required for an advance payment.");
  const bank = await getVerifiedEmployeeReimbursementBankAccount({ userId: requester._id, currency: request.currency, session });
  if (!bank) throw new AppError(422, "Track C requires a verified employee bank account before the advance can be released.", undefined, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
  if (request.observation?.code === ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED && !request.observation.resolvedAt) {
    request.observation.resolvedAt = new Date();
    request.observation.resolvedBy = user._id;
  }

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
  // Reservation already happened at final approval. Never make a second budget hold.
  const commitment = request.budgetCommitment;
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
  // Paid the same working day (next working day after the cut-off), not on the 15th / 30th.
  const payDate = await advancePaymentDateKey();
  const accountsPayable = await createAccountsPayableFromVoucher({ request, voucher, user, paymentPriority: "PRIORITY", dueDate: new Date(`${payDate}T17:00:00.000Z`), session });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.ACCOUNTED, user, req, action: "ADVANCE_PROVISIONED", comments: "Accounting provisioned the budget-committed Track C advance to Account 14; expense execution remains deferred until rendition validation.", session, skipControls: true, skipRoleCheck: automatic });
  return { accountsPayable, commitment };
}
