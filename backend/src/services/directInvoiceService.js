import FinancialRequest from "../models/FinancialRequest.js";
import { recordAudit } from "./auditService.js";
import { preflightDirectPayment, provisionDirectPayment } from "./directPaymentService.js";
import { notificationText, notifyRoles, resolveNotification } from "./notificationService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { assertInvoiceEvidencePair, validateInvoiceAgainstRequest } from "./xmlValidationService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { actsAsRequester } from "../utils/permissions.js";

const INVOICE_FIELDS = Object.freeze({ xml: "XML", pdf: "PDF" });

// A Track B request sent with only its quote is approved and its budget reserved; it then waits
// for the supplier's invoice. Registering it here runs the same controls as a B request sent with
// its invoice - the invoice must match the approved amounts to the cent, be valid at SUNAT and not
// be a duplicate - and then provisions the payable for Treasury exactly as on approval.
export async function registerDirectPaymentInvoice({ requestId, files = {}, user, req }) {
  const uploaded = Object.keys(INVOICE_FIELDS).flatMap((field) => files[field] || []);
  let persisted = {};
  let stored = false;
  try {
    const request = await FinancialRequest.findById(requestId).select("+attachments.path").populate("supplier");
    if (!request) throw new AppError(404, "Financial request not found.", { id: requestId }, ERROR_CODES.NOT_FOUND);
    if (request.flowType !== FLOW_TYPE.B) throw new AppError(422, "This step is only for Track B requests.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
    if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) throw new AppError(409, "The invoice is registered once the request is approved and its budget reserved.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    const owner = String(request.requester?._id || request.requester || request.solicitor || "") === String(user._id);
    if (![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role) && !(owner && actsAsRequester(user))) throw new AppError(403, "Only the requester or Accounting can register this invoice.", undefined, ERROR_CODES.FORBIDDEN);
    if (!uploaded.length) throw new AppError(422, "Upload the invoice XML or its factura PDF.", { missing: ["XML", "PDF"] }, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);

    persisted = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    const attachments = Object.entries(INVOICE_FIELDS).flatMap(([field, kind]) => (persisted[field] || []).map((file) => ({
      kind, originalName: file.originalname, filename: file.filename, path: file.path, url: file.url, mimetype: file.mimetype, size: file.size, checksum: file.checksum, uploadedBy: user._id
    })));
    await assertInvoiceEvidencePair(persisted.xml?.[0]?.path, persisted.pdf?.[0]?.path);
    // The XML when there is one, otherwise the factura PDF.
    const evidence = attachments.find((item) => item.kind === "XML") || attachments.find((item) => item.kind === "PDF");
    const validation = await validateInvoiceAgainstRequest(evidence.path, {
      supplier: request.supplier, fiscalData: request.fiscalData, currency: request.currency,
      totalNet: request.totalNet, totalIGV: request.totalIGV, totalAmount: request.totalAmount
    }, { request, requestNumber: request.requestNumber, supplier: request.supplier, user, fileName: evidence.originalName });
    request.attachments.push(...attachments);
    request.xmlValidation = validation;
    request.xmlValidationHistory.push(validation);

    const preflight = await preflightDirectPayment({ request, user, req, observe: false });
    if (!preflight.valid) throw new AppError(422, preflight.detail || "The invoice could not be verified.", { code: preflight.code }, preflight.code || ERROR_CODES.XML_VALIDATION_FAILED);
    const result = await runFinancialOperation(async (session) => {
      const provisioned = await provisionDirectPayment({ request, user, req, session, preflight });
      return { request, ...provisioned };
    });
    stored = true;
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "DIRECT_INVOICE_REGISTERED", user, req, module: "REQUESTS", newValues: { invoice: evidence.originalName, accountsPayable: result.accountsPayable?._id } });
    await resolveNotification(`request:${request._id}:direct-invoice-needed`);
    await notifyRoles({
      roles: [ROLES.TREASURY],
      eventKey: `request:${request._id}:treasury`,
      type: "TREASURY_PAYMENT",
      title: notificationText("Priority payment ready"),
      message: notificationText("{requestNumber} was auto-provisioned and is ready for priority Treasury payment.", { requestNumber: request.requestNumber }),
      path: `/treasury?tab=prepare&request=${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
    return result;
  } finally {
    // Nothing is kept from an invoice that was refused.
    if (!stored) await cleanupUploadedFiles(Object.keys(persisted).length ? persisted : files);
  }
}
