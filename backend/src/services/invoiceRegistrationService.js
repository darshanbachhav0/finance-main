import FinancialRequest from "../models/FinancialRequest.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { createAccountsPayableFromVoucher } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { executeBudgetAmount } from "./budgetService.js";
import { notifyRoles } from "./notificationService.js";
import {
  assertPurchaseOrderInvoiceFits,
  consumePurchaseOrderBalance,
  restorePurchaseOrderBalance
} from "./purchaseOrderMatchingService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import {
  createSunatVoucher,
  findDuplicateVoucher,
  splitVoucherNumber,
  validateVoucherWithSunat,
  voucherIdentity
} from "./sunatVoucherService.js";
import { runFinancialOperation } from "./transactionService.js";
import { fileChecksum, parseInvoiceXml } from "./xmlValidationService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, ROLES } from "../utils/constants.js";

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
  for (const value of [
    files.xml && attachment(files.xml, "XML", userId),
    files.pdf && attachment(files.pdf, "PDF", userId),
    files.conformity && attachment(files.conformity, "CONFORMITY", userId)
  ].filter(Boolean)) {
    const exists = request.attachments.some((item) => item.kind === value.kind && item.checksum && item.checksum === value.checksum);
    if (!exists) request.attachments.push(value);
  }
}

async function observeRequest(request, status, code, detail, user, req, { session } = {}) {
  request.observation = { code, detail, observedAt: new Date(), observedBy: user._id };
  if (request.status === REQUEST_STATUS.PAYMENT_BOUNCED) {
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

async function recordObservation({ request, purchaseOrder, voucher, status, requestStatus, code, detail, sunatResult, xmlFile, pdfFile, conformityFile, user, req, placeholder }) {
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
  addAttemptAttachments(request, { xml: xmlFile, pdf: pdfFile, conformity: conformityFile }, user._id);
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

export async function registerA1Invoice({ requestId, files, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.flowType !== FLOW_TYPE.A1) {
    throw new AppError(422, "This invoice endpoint is only for Track A1 requests.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
  }
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  if (user.role === ROLES.SOLICITOR && String(ownerId) !== String(user._id)) {
    throw new AppError(403, "Solicitors can register invoices only for their own requests.", undefined, ERROR_CODES.FORBIDDEN);
  }
  if (![REQUEST_STATUS.BUDGET_COMMITTED, REQUEST_STATUS.PROVISIONED_CXP, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, REQUEST_STATUS.PAYMENT_BOUNCED].includes(request.status)) {
    throw new AppError(409, "Track A1 invoice can only be registered after PO/budget approval.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const xmlTemp = files?.xml?.[0];
  const pdfTemp = files?.pdf?.[0];
  const conformityTemp = files?.conformity?.[0];
  if (!xmlTemp || !pdfTemp || !conformityTemp) {
    throw new AppError(422, "Track A1 requires XML, PDF and conformity evidence.", { required: ["xml", "pdf", "conformity"] }, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
  }
  const purchaseOrder = await PurchaseOrder.findOne({ request: request._id });
  if (!purchaseOrder) throw new AppError(409, "Purchase Order is required for Track A1 invoice matching.", undefined, ERROR_CODES.PROCUREMENT_NOT_READY);

  let persisted;
  let evidenceAdopted = false;
  try {
    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    const xmlFile = persisted.xml[0];
    const pdfFile = persisted.pdf[0];
    const conformityFile = persisted.conformity[0];
    xmlFile.checksum ||= await fileChecksum(xmlFile.path);
    const data = await parseInvoiceXml(xmlFile.path);
    const parts = splitVoucherNumber(data.invoiceNumber);
    const voucher = {
      ...data,
      voucherType: "FACTURA",
      series: parts.series,
      number: parts.number,
      currency: data.currency || request.currency
    };
    const expectedRuc = String(request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "").replace(/\D/g, "");
    const { duplicate, placeholder } = await reusablePlaceholder(voucher, request._id);

    if (!data.ruc || data.ruc !== expectedRuc) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "RUC_MISMATCH", detail: "The XML issuer RUC does not match the approved supplier.", xmlFile, pdfFile, conformityFile, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }
    if (duplicate && !placeholder) {
      addAttemptAttachments(request, { xml: xmlFile, pdf: pdfFile, conformity: conformityFile }, user._id);
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
        ? "Automated SUNAT validation is not configured. Configure the production gateway or use MOCK mode only in development."
        : error.message;
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "OBSERVADO_SUNAT", detail, xmlFile, pdfFile, conformityFile, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }
    if (!sunatResult.valid) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_SUNAT", requestStatus: REQUEST_STATUS.OBSERVED_SUNAT, code: "OBSERVADO_SUNAT", detail: sunatResult.detail || "SUNAT validation failed.", sunatResult, xmlFile, pdfFile, conformityFile, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }

    try {
      await assertPurchaseOrderInvoiceFits(purchaseOrder._id, data.totalAmount, { currency: voucher.currency });
    } catch (error) {
      const result = await recordObservation({ request, purchaseOrder, voucher, status: "OBSERVED_AMOUNT_EXCEEDED", requestStatus: REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, code: "OBSERVADO_MONTO_EXCEDIDO", detail: error.message, sunatResult, xmlFile, pdfFile, conformityFile, user, req, placeholder });
      evidenceAdopted = true;
      return result;
    }

    let consumedWithoutTransaction = false;
    let createdVoucherId;
    try {
      const result = await runFinancialOperation(async (session) => {
        const currentRequest = await FinancialRequest.findById(request._id).select("+attachments.path").populate("supplier").session(session || null);
        const currentPurchaseOrder = await PurchaseOrder.findById(purchaseOrder._id).session(session || null);
        if (!currentRequest || !currentPurchaseOrder) throw new AppError(404, "Request or Purchase Order no longer exists.", undefined, ERROR_CODES.NOT_FOUND);
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
            validationStatus: "VALID",
            observationDetail: "",
            sunatStatus: sunatResult.status || sunatResult.fiscal?.status,
            taxpayerStatus: sunatResult.taxpayer?.condition || sunatResult.taxpayer?.status,
            sunatProvider: sunatResult.fiscal?.source || sunatResult.taxpayer?.source,
            xmlPath: xmlFile.path,
            xmlUrl: xmlFile.url,
            xmlChecksum: xmlFile.checksum,
            pdfPath: pdfFile.path,
            pdfUrl: pdfFile.url,
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

        addAttemptAttachments(currentRequest, { xml: xmlFile, pdf: pdfFile, conformity: conformityFile }, user._id);
        currentRequest.fiscalData = {
          supplierIdentifierNormalized: expectedRuc,
          voucherType: "FACTURA",
          documentType: "FACTURA",
          series: parts.series,
          number: parts.number,
          documentDate: data.issueDate,
          accountingDate: new Date(),
          fiscalPeriod: currentRequest.accountingPeriod,
          processedAt: new Date(),
          processedBy: user._id,
          comments: "A1 invoice matched to Purchase Order and SUNAT."
        };
        currentRequest.observation = undefined;
        if ([REQUEST_STATUS.PROVISIONED_CXP, REQUEST_STATUS.PAYMENT_BOUNCED].includes(currentRequest.status)) {
          await currentRequest.save({ session });
          await recordAudit({
            entityType: "FinancialRequest",
            entity: currentRequest,
            requestId: currentRequest._id,
            action: "A1_ADDITIONAL_INVOICE_PROVISIONED",
            user,
            req,
            module: "ACCOUNTING",
            newValues: { accountsPayable: accountsPayable._id, voucher: sunatVoucher._id },
            session
          });
        } else {
          await transitionRequest({
            request: currentRequest,
            targetStatus: REQUEST_STATUS.PROVISIONED_CXP,
            user,
            req,
            action: "A1_INVOICE_PROVISIONED",
            comments: "Invoice matched to PO, validated with SUNAT, and provisioned to CXP.",
            session
          });
        }
        return { request: currentRequest, sunatVoucher, accountsPayable };
      });
      evidenceAdopted = true;
      await recordAudit({
        entityType: "SunatVoucher",
        entity: result.sunatVoucher,
        requestId: result.request._id,
        action: "A1_PROVISIONED",
        user,
        req,
        module: "ACCOUNTING",
        newValues: { accountsPayable: result.accountsPayable._id, purchaseOrder: purchaseOrder._id, amount: data.totalAmount }
      });
      await notifyRoles({
        roles: [ROLES.TREASURY],
        eventKey: `request:${result.request._id}:treasury:${result.accountsPayable._id}`,
        type: "TREASURY_PAYMENT",
        title: "CXP ready for payment",
        message: `${result.request.requestNumber} invoice ${data.invoiceNumber} is ready for Treasury.`,
        path: "/treasury",
        entityType: "AccountsPayable",
        entityId: result.accountsPayable._id
      });
      return { ...result, observed: false };
    } catch (error) {
      if (consumedWithoutTransaction) await restorePurchaseOrderBalance(purchaseOrder._id, data.totalAmount).catch(() => undefined);
      if (createdVoucherId) await SunatVoucher.deleteOne({ _id: createdVoucherId, accountsPayable: { $exists: false } }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (persisted && !evidenceAdopted) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}
