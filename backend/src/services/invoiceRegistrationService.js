import { assertPostingAllowed, syncFinancialProgress } from "./financialProgressService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import SunatVoucher from "../models/SunatVoucher.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import AccountsPayable from "../models/AccountsPayable.js";
import { createAccountsPayableFromVoucher, invoicePostingPeriod } from "./accountingService.js";
import { applyAdjustmentNote, registerAdjustmentNote } from "./adjustmentNoteService.js";
import { retryInvoiceObservation } from "./batchInvoiceService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { recordAudit } from "./auditService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { executeBudgetAmount } from "./budgetService.js";
import { notificationText, notifyRoles } from "./notificationService.js";
import {
  assertPurchaseOrderInvoiceFits,
  consumePurchaseOrderBalance,
  restorePurchaseOrderBalance
} from "./purchaseOrderMatchingService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import {
  applyManualSunatOverride,
  createSunatVoucher,
  findDuplicateVoucher,
  hasManualSunatException,
  manualExceptionEvidence,
  splitVoucherNumber,
  validateVoucherWithSunat,
  voucherIdentity
} from "./sunatVoucherService.js";
import { isAdjustmentNote } from "../utils/voucherIdentity.js";
import { runFinancialOperation } from "./transactionService.js";
import { fileChecksum, parseInvoiceXml } from "./xmlValidationService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { DOCUMENT_PHASE, ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, ROLES } from "../utils/constants.js";

const invoiceAttachmentKinds = Object.freeze({
  xml: "XML",
  pdf: "PDF",
  feeReceipt: "FEE_RECEIPT",
  conformity: "CONFORMITY",
  activityReport: "ACTIVITY_REPORT",
  contract: "CONTRACT",
  supporting: "SUPPORTING"
});

// Explicit correction only: never infer that a second invoice replaces a legitimate obligation.
export async function supersedeObservedInvoice({ requestId, voucherId, replacementId, reason, user, req }) {
  if (![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user?.role)) throw new AppError(403, "Accounting permission is required.");
  if (!String(reason || "").trim()) throw new AppError(422, "A replacement reason is required.");
  return runFinancialOperation(async (session) => {
    const request = await FinancialRequest.findById(requestId).session(session || null);
    if (!request) throw new AppError(404, "Request not found.");
    if (["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"].includes(request.status)) throw new AppError(409, "Terminal requests cannot be corrected.");
    const original = await SunatVoucher.findOne({ _id: voucherId, request: requestId }).session(session || null);
    const replacement = await SunatVoucher.findOne({ _id: replacementId, request: requestId }).session(session || null);
    if (!original || !replacement || String(original._id) === String(replacement._id)) throw new AppError(422, "Choose two different invoices from this request.");
    if (original.accountsPayable || original.provisionedAt || original.batch || !["OBSERVED_SUNAT", "OBSERVED_AMOUNT_EXCEEDED", "PENDING"].includes(original.validationStatus)) throw new AppError(409, "Only an unposted individual invoice observation can be replaced.");
    const payable = await AccountsPayable.findOne({ _id: replacement.accountsPayable, request: requestId, sunatVoucher: replacement._id, status: { $ne: "CANCELLED" } }).populate("provisionJournal").session(session || null);
    if (!payable || payable.provisionJournal?.status !== "POSTED" || replacement.supersededBy || !["VALID", "MANUAL_EXCEPTION"].includes(replacement.validationStatus)) throw new AppError(409, "The replacement must have an active payable and posted accounting journal.");
    if (original.supersededBy && String(original.supersededBy) !== String(replacement._id)) throw new AppError(409, "This invoice already has a different replacement.");
    if (!original.supersededBy) {
      original.supersededBy = replacement._id;
      original.supersededAt = new Date();
      original.supersededByUser = user._id;
      await original.save({ session });
      await recordAudit({ entityType: "SunatVoucher", entity: original, requestId: request._id, user, req, session, module: "ACCOUNTING", action: "INVOICE_SUPERSEDED", comments: reason.trim(), oldValues: { validationStatus: original.validationStatus }, newValues: { supersededBy: replacement._id } });
    }
    await syncFinancialProgress({ request, user, req, session, action: "INVOICE_REPLACEMENT_PROGRESS_UPDATED" });
    return request;
  });
}

function attachment(file, kind, userId) {
  return {
    kind,
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    url: file.url,
    mimetype: file.mimetype,
    size: file.size,
    checksum: file.checksum,
    uploadedBy: userId
  };
}

function addAttemptAttachments(request, files, userId) {
  for (const value of Object.entries(invoiceAttachmentKinds).flatMap(([field, kind]) => {
    const file = files[field];
    return file ? [attachment(file, kind, userId)] : [];
  })) {
    const exists = request.attachments.some((item) => item.kind === value.kind && item.checksum && item.checksum === value.checksum);
    if (!exists) request.attachments.push(value);
  }
}

async function observeRequest(request, status, code, detail, user, req, { session } = {}) {
  request.observation = { code, detail, observedAt: new Date(), observedBy: user._id };
  if ([REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED, REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED, REQUEST_STATUS.PAYMENT_BOUNCED].includes(request.status)) {
    await request.save({ session });
  } else if (request.status !== status) {
    await transitionRequest({ request, targetStatus: status, user, req, action: code, comments: detail, skipControls: true, session });
  } else {
    await request.save({ session });
  }
}

async function reusablePlaceholder(voucher, requestId, session) {
  const duplicate = await findDuplicateVoucher(voucher, { session });
  if (!duplicate) return { duplicate: null, placeholder: null };
  const sameObservedRequest = String(duplicate.request) === String(requestId)
    && !duplicate.accountsPayable
    && duplicate.validationStatus !== "VALID";
  return { duplicate, placeholder: sameObservedRequest ? duplicate : null };
}

async function saveObservedVoucher({ request, purchaseOrder, supplier, voucher, status, detail, sunatResult, xmlFile, pdfFile, user, placeholder }) {
  if (!placeholder) {
    return createSunatVoucher({
      request,
      purchaseOrder,
      supplier,
      voucher,
      flowType: FLOW_TYPE.A1,
      validationStatus: status,
      observationDetail: detail,
      sunatResult,
      xmlFile,
      pdfFile,
      user
    });
  }
  const identity = voucherIdentity(voucher);
  placeholder.rucIssuer = identity.rucIssuer;
  placeholder.voucherType = identity.voucherType;
  placeholder.series = identity.series;
  placeholder.number = identity.number;
  placeholder.seriesNumber = `${identity.series}-${identity.number}`;
  placeholder.issueDate = voucher.issueDate;
  placeholder.currency = voucher.currency || request.currency;
  placeholder.netAmount = voucher.netAmount;
  placeholder.igvAmount = voucher.igvAmount;
  placeholder.xmlAmount = voucher.totalAmount;
  placeholder.validationStatus = status;
  placeholder.observationDetail = detail;
  placeholder.sunatStatus = sunatResult?.status || sunatResult?.fiscal?.status;
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

async function recordObservation({ request, purchaseOrder, voucher, status, requestStatus, code, detail, sunatResult, xmlFile, pdfFile, conformityFile, evidenceFiles, user, req, placeholder }) {
  let storedVoucher = placeholder;
  if (voucher?.ruc && voucher?.series && voucher?.number && voucher?.totalAmount) {
    storedVoucher = await saveObservedVoucher({
      request,
      purchaseOrder,
      supplier: request.supplier,
      voucher,
      status,
      detail,
      sunatResult,
      xmlFile,
      pdfFile,
      user,
      placeholder
    });
  }
  addAttemptAttachments(request, evidenceFiles || { xml: xmlFile, pdf: pdfFile, conformity: conformityFile }, user._id);
  await observeRequest(request, requestStatus, code, detail, user, req);
  await recordAudit({
    entityType: storedVoucher ? "SunatVoucher" : "FinancialRequest",
    entity: storedVoucher || request,
    requestId: request._id,
    action: code,
    user,
    req,
    module: "ACCOUNTING",
    newValues: { status, detail, purchaseOrder: purchaseOrder._id }
  });
  return { request, sunatVoucher: storedVoucher, observed: true, sunatResult };
}

// Posts one validated (or manually excepted) A1 invoice: consumes the PO balance, stores the
// SUNAT evidence and creates the CXP with its provision in the invoice date's period.
async function provisionA1Voucher({ request, purchaseOrder, voucher, data, sunatResult, xmlFile, pdfFile, evidenceFiles, user, req }) {
  const expectedRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
  const parts = { series: voucher.series, number: voucher.number };
  let consumedWithoutTransaction = false;
  let createdVoucherId;
  try {
    const result = await runFinancialOperation(async (session) => {
      const currentRequest = await FinancialRequest.findById(request._id).select("+attachments.path").populate("supplier").session(session || null);
      const currentPurchaseOrder = await PurchaseOrder.findById(purchaseOrder._id).session(session || null);
      if (!currentRequest || !currentPurchaseOrder) throw new AppError(404, "Request or Purchase Order no longer exists.", undefined, ERROR_CODES.NOT_FOUND);
      await assertPostingAllowed(currentRequest, { user, req });
      const duplicateCheck = await reusablePlaceholder(voucher, currentRequest._id, session);
      if (duplicateCheck.duplicate && !duplicateCheck.placeholder) {
        throw new AppError(409, "The supplier voucher is already registered.", { voucher: duplicateCheck.duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);
      }
      await assertPurchaseOrderInvoiceFits(currentPurchaseOrder._id, data.totalAmount, { currency: voucher.currency, session });
      await consumePurchaseOrderBalance(currentPurchaseOrder._id, data.totalAmount, { session });
      if (!session) consumedWithoutTransaction = true;

      let sunatVoucher = duplicateCheck.placeholder ? await SunatVoucher.findById(duplicateCheck.placeholder._id).session(session || null) : null;
      if (!sunatVoucher) {
        sunatVoucher = await createSunatVoucher({
          request: currentRequest,
          purchaseOrder: currentPurchaseOrder,
          supplier: currentRequest.supplier,
          voucher,
          flowType: FLOW_TYPE.A1,
          validationStatus: "VALID",
          sunatResult,
          xmlFile,
          pdfFile,
          user,
          session
        });
        createdVoucherId = sunatVoucher._id;
      } else {
        const identity = voucherIdentity(voucher);
        const manual = hasManualSunatException(sunatVoucher);
        sunatVoucher.set({
          rucIssuer: identity.rucIssuer,
          voucherType: identity.voucherType,
          series: identity.series,
          number: identity.number,
          seriesNumber: `${identity.series}-${identity.number}`,
          issueDate: voucher.issueDate,
          currency: voucher.currency,
          netAmount: voucher.netAmount,
          igvAmount: voucher.igvAmount,
          xmlAmount: voucher.totalAmount,
          // An approved manual exception stays visible as such; it is never relabelled VALID.
          validationStatus: manual ? "MANUAL_EXCEPTION" : "VALID",
          observationDetail: manual ? sunatVoucher.observationDetail : "",
          sunatStatus: sunatResult.status || sunatResult.fiscal?.status,
          taxpayerStatus: sunatResult.taxpayer?.condition || sunatResult.taxpayer?.status,
          sunatProvider: sunatResult.fiscal?.source || sunatResult.taxpayer?.source,
          xmlPath: xmlFile?.path || sunatVoucher.xmlPath,
          xmlUrl: xmlFile?.url || sunatVoucher.xmlUrl,
          xmlChecksum: xmlFile?.checksum || sunatVoucher.xmlChecksum,
          pdfPath: pdfFile?.path || sunatVoucher.pdfPath,
          pdfUrl: pdfFile?.url || sunatVoucher.pdfUrl,
          validatedAt: new Date(),
          validatedBy: user._id
        });
        await sunatVoucher.save({ session });
      }

      const accountsPayable = await createAccountsPayableFromVoucher({
        request: currentRequest,
        supplier: currentRequest.supplier,
        voucher,
        purchaseOrder: currentPurchaseOrder,
        sunatVoucher,
        user,
        flowType: FLOW_TYPE.A1,
        session
      });
      sunatVoucher.accountsPayable = accountsPayable._id;
      sunatVoucher.provisionedAt = new Date();
      await sunatVoucher.save({ session });
      if (!accountsPayable.budgetExecutedAt) {
        await executeBudgetAmount(currentRequest, user._id, accountsPayable.penEquivalent, {
          session,
          comments: `Track A1 invoice ${data.invoiceNumber} provisioned against ${currentPurchaseOrder.poNumber}.`
        });
        accountsPayable.budgetExecutedAt = new Date();
        await accountsPayable.save({ session });
      }

      if (evidenceFiles) addAttemptAttachments(currentRequest, evidenceFiles, user._id);
      currentRequest.fiscalData = {
        supplierIdentifierNormalized: expectedRuc,
        voucherType: voucher.voucherType,
        documentType: voucher.voucherType,
        series: parts.series,
        number: parts.number,
        documentDate: data.issueDate,
        accountingDate: new Date(),
        // The invoice is booked in the period of its own date, not the request's creation month.
        fiscalPeriod: invoicePostingPeriod(data.issueDate),
        processedAt: new Date(),
        processedBy: user._id,
        comments: hasManualSunatException(sunatVoucher) ? "A1 invoice matched to Purchase Order under an approved manual SUNAT exception." : "A1 invoice matched to Purchase Order and SUNAT."
      };
      currentRequest.observation = undefined;
      await syncFinancialProgress({ request: currentRequest, user, req, session, action: "A1_INVOICE_PROVISIONED" });
      return { request: currentRequest, sunatVoucher, accountsPayable };
    });
    await recordAudit({
      entityType: "SunatVoucher",
      entity: result.sunatVoucher,
      requestId: result.request._id,
      action: "A1_PROVISIONED",
      user,
      req,
      module: "ACCOUNTING",
      newValues: { accountsPayable: result.accountsPayable._id, purchaseOrder: purchaseOrder._id, amount: data.totalAmount, validationStatus: result.sunatVoucher.validationStatus }
    });
    await notifyRoles({
      roles: [ROLES.TREASURY],
      eventKey: `request:${result.request._id}:treasury:${result.accountsPayable._id}`,
      type: "TREASURY_PAYMENT",
      title: notificationText("CXP ready for payment"),
      message: notificationText("{requestNumber} invoice {invoiceNumber} is ready for Treasury.", { requestNumber: result.request.requestNumber, invoiceNumber: data.invoiceNumber }),
      path: `/treasury?tab=prepare&record=${result.accountsPayable._id}`,
      entityType: "AccountsPayable",
      entityId: result.accountsPayable._id
    });
    return { ...result, observed: false };
  } catch (error) {
    if (consumedWithoutTransaction) await restorePurchaseOrderBalance(purchaseOrder._id, data.totalAmount).catch(() => undefined);
    if (createdVoucherId) await SunatVoucher.deleteOne({ _id: createdVoucherId, accountsPayable: { $exists: false } }).catch(() => undefined);
    throw error;
  }
}

export async function registerA1Invoice({ requestId, files, originalVoucherId, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.flowType !== FLOW_TYPE.A1) {
    throw new AppError(422, "This invoice endpoint is only for Track A1 requests.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  }
  await assertPostingAllowed(request, { user, req });
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  if (user.role === ROLES.SOLICITOR && String(ownerId) !== String(user._id)) {
    throw new AppError(403, "Solicitors can register invoices only for their own requests.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (![REQUEST_STATUS.BUDGET_COMMITTED, REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED, REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, REQUEST_STATUS.PAYMENT_BOUNCED].includes(request.status)) {
    throw new AppError(409, "Track A1 invoice can only be registered after PO/budget approval.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const incomingAttachments = Object.entries(invoiceAttachmentKinds).flatMap(([field, kind]) => (files?.[field] || []).map(() => ({ kind })));
  const availableAttachments = [...(request.attachments || []), ...incomingAttachments];
  await assertConfiguredDocuments(request, DOCUMENT_PHASE.INVOICE_REGISTRATION, incomingAttachments);
  await assertConfiguredDocuments(request, DOCUMENT_PHASE.ACCOUNTING, availableAttachments);
  const purchaseOrder = await PurchaseOrder.findOne({ request: request._id });
  if (!purchaseOrder) throw new AppError(409, "Purchase Order is required for Track A1 invoice matching.", undefined, ERROR_CODES.PROCUREMENT_NOT_READY);

  let persisted;
  let evidenceAdopted = false;
  try {
    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    const xmlFile = persisted.xml?.[0];
    const pdfFile = persisted.pdf?.[0] || persisted.feeReceipt?.[0];
    const conformityFile = persisted.conformity?.[0];
    const evidenceFiles = Object.fromEntries(Object.keys(invoiceAttachmentKinds).map((field) => [field, persisted[field]?.[0]]));
    if (!xmlFile?.path) throw new AppError(422, "Invoice XML is required before accounting.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
    xmlFile.checksum ||= await fileChecksum(xmlFile.path);
    const data = await parseInvoiceXml(xmlFile.path);
    // The XML's own document type decides the path: a credit/debit note adjusts its original
    // invoice (linked from the XML reference or chosen by the user) instead of creating a payable.
    if (isAdjustmentNote(data.voucherType)) {
      const result = await registerAdjustmentNote({ xmlFile, pdfFile, originalVoucherId, requestId: request._id, user, req });
      evidenceAdopted = true;
      const refreshed = await FinancialRequest.findById(request._id).populate("supplier");
      return { request: refreshed, sunatVoucher: result.note || result.sunatVoucher, accountsPayable: result.accountsPayable, supplierCredit: result.supplierCredit, observed: result.observed, adjustment: true };
    }
    const parts = splitVoucherNumber(data.invoiceNumber);
    const voucher = {
      ...data,
      voucherType: data.voucherType || "FACTURA",
      series: parts.series,
      number: parts.number,
      currency: data.currency || request.currency
    };
    // Guard the period the invoice actually lands in (its document date).
    await guardAccountingPeriod({ period: invoicePostingPeriod(data.issueDate), action: "POST", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
    const expectedRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
    const { duplicate, placeholder } = await reusablePlaceholder(voucher, request._id);

    if (!data.ruc || data.ruc !== expectedRuc) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "RUC_MISMATCH", detail: "The XML issuer RUC does not match the approved supplier.", xmlFile, pdfFile, conformityFile, evidenceFiles, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }
    if (duplicate && !placeholder) {
      addAttemptAttachments(request, evidenceFiles, user._id);
      await observeRequest(request, REQUEST_STATUS.OBSERVED_SUNAT, "DUPLICATE_VOUCHER", "The RUC + voucher type + series + number already exists.", user, req);
      evidenceAdopted = true;
      await recordAudit({ entityType: "FinancialRequest", entity: request, requestId: request._id, action: "DUPLICATE_VOUCHER", user, req, module: "ACCOUNTING", newValues: { duplicateVoucher: duplicate._id } });
      return { request, duplicateVoucher: duplicate, observed: true };
    }

    let sunatResult;
    try {
      sunatResult = await validateVoucherWithSunat(voucher, { request, user });
    } catch (error) {
      const detail = error.code === ERROR_CODES.INTEGRATION_NOT_CONFIGURED
        ? `${error.message || "Automated SUNAT validation is not configured."} Accounting can approve a manual SUNAT exception for this invoice.`
        : error.message;
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "OBSERVADO_SUNAT", detail, xmlFile, pdfFile, conformityFile, evidenceFiles, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }
    if (!sunatResult.valid) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "OBSERVADO_SUNAT", detail: sunatResult.detail || "SUNAT validation failed.", sunatResult, xmlFile, pdfFile, conformityFile, evidenceFiles, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }

    try {
      await assertPurchaseOrderInvoiceFits(purchaseOrder._id, data.totalAmount, { currency: voucher.currency });
    } catch (error) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_AMOUNT_EXCEEDED", requestStatus: REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, code: "OBSERVADO_MONTO_EXCEDIDO", detail: error.message, sunatResult, xmlFile, pdfFile, conformityFile, evidenceFiles, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }

    const result = await provisionA1Voucher({ request, purchaseOrder, voucher, data, sunatResult, xmlFile, pdfFile, evidenceFiles, user, req });
    evidenceAdopted = true;
    return result;
  } catch (error) {
    if (persisted && !evidenceAdopted) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}

/**
 * Accounting approves a manual SUNAT exception on an observed invoice (SUNAT down, or PADRON-only
 * mode which can never verify a CPE). One Accounting user is enough. The exception is audited and
 * the invoice is posted immediately when it can be: A1 invoices are provisioned to CXP, A2 batch
 * observations are revalidated, adjustment notes are applied. A Track B request whose approvals
 * are complete continues to budget commitment and CXP immediately, without new approvals.
 * Manually processed requests post on their next processing attempt, which accepts the exception.
 */
export async function approveManualSunatException({ requestId, voucherId, reason, evidenceReference, user, req }) {
  const request = await FinancialRequest.findById(requestId).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  const voucher = await applyManualSunatOverride({ request, voucherId, reason, evidenceReference, user, req });
  const outcome = { voucher, provisioned: false };
  async function deferredPosting(error) {
    const detail = ["ENOENT", ERROR_CODES.STORED_FILE_MISSING].includes(error.code)
      ? "The saved invoice file is no longer available. Re-upload the same XML and PDF in Documents and retry invoice validation. The manual SUNAT exception is already recorded."
      : error.message;
    // Preserve the exception and history, but do not leave the requester looking at the
    // pre-approval SUNAT error when a different posting control is now blocking progress.
    if (request.status === REQUEST_STATUS.OBSERVED_SUNAT) {
      await FinancialRequest.updateOne({ _id: request._id, status: REQUEST_STATUS.OBSERVED_SUNAT }, {
        $set: { observation: { code: "INVOICE_POSTING_PENDING", detail, observedAt: new Date(), observedBy: user._id } }
      });
    }
    await recordAudit({ entityType: "SunatVoucher", entity: voucher, requestId: request._id,
      action: "MANUAL_EXCEPTION_POSTING_DEFERRED", user, req, module: "ACCOUNTING",
      newValues: { voucher: voucher._id, code: error.code, detail }, comments: detail });
    return { ...outcome, detail };
  }
  if (isAdjustmentNote(voucher.voucherType)) {
    if (voucher.adjustmentAppliedAt) return outcome;
    try {
      const applied = await applyAdjustmentNote({ noteVoucherId: voucher._id, user, req });
      return { ...outcome, provisioned: true, accountsPayable: applied.accountsPayable, supplierCredit: applied.supplierCredit };
    } catch (error) {
      return deferredPosting(error);
    }
  }
  if (voucher.accountsPayable) return { ...outcome, provisioned: true };
  try {
    if (request.flowType === FLOW_TYPE.B && request.status === REQUEST_STATUS.OBSERVED_SUNAT) {
      // Imported lazily: approvalService depends on this module's neighbours.
      const { commitApprovedRequestBudget } = await import("./approvalService.js");
      const current = await FinancialRequest.findById(request._id).select("+attachments.path").populate("supplier");
      const result = await commitApprovedRequestBudget({ request: current, user, req, automatic: true });
      if (result.status !== REQUEST_STATUS.ACCOUNTED) return deferredPosting(new Error(result.observation?.detail || "The invoice could not be posted after the manual SUNAT exception."));
      return { ...outcome, provisioned: true, request: result, accountsPayable: await AccountsPayable.findOne({ request: result._id, status: { $ne: "CANCELLED" } }) };
    }
    if (voucher.batch) {
      const observation = await InvoiceObservation.findOne({ voucher: voucher._id, resolutionStatus: "OPEN" });
      if (!observation) return outcome;
      const result = await retryInvoiceObservation({ observationId: observation._id, user, req });
      return { ...outcome, voucher: result.voucher, provisioned: true, accountsPayable: result.accountsPayable };
    }
    if (voucher.flowType === FLOW_TYPE.A1 && request.flowType === FLOW_TYPE.A1) {
      const purchaseOrder = await PurchaseOrder.findOne({ request: request._id });
      if (!purchaseOrder) return deferredPosting(new Error("Purchase Order is required for Track A1 invoice matching."));
      const stored = await SunatVoucher.findById(voucher._id).select("+xmlPath +pdfPath");
      if (!stored.xmlPath) return deferredPosting({ code: "ENOENT" });
      const data = await parseInvoiceXml(stored.xmlPath);
      const parts = splitVoucherNumber(data.invoiceNumber);
      const invoice = { ...data, voucherType: data.voucherType || stored.voucherType, series: parts.series, number: parts.number, currency: data.currency || request.currency };
      const expectedRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
      if (data.ruc !== expectedRuc) return deferredPosting(new Error("The XML issuer RUC does not match the approved supplier."));
      await guardAccountingPeriod({ period: invoicePostingPeriod(data.issueDate), action: "POST", user, req, module: "ACCOUNTING", entityType: "SunatVoucher", entityId: stored._id, requestId: request._id });
      await assertPurchaseOrderInvoiceFits(purchaseOrder._id, data.totalAmount, { currency: invoice.currency });
      const xmlFile = { path: stored.xmlPath, url: stored.xmlUrl, checksum: stored.xmlChecksum };
      const pdfFile = stored.pdfPath ? { path: stored.pdfPath, url: stored.pdfUrl } : undefined;
      const result = await provisionA1Voucher({ request, purchaseOrder, voucher: invoice, data, sunatResult: manualExceptionEvidence(stored), xmlFile, pdfFile, user, req });
      return { ...outcome, voucher: result.sunatVoucher, provisioned: true, accountsPayable: result.accountsPayable, request: result.request };
    }
  } catch (error) {
    // The exception itself is recorded; posting can be retried once the blocker is resolved.
    return deferredPosting(error);
  }
  return outcome;
}

