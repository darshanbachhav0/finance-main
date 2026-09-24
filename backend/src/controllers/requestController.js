import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  closeFinancialRequest,
  createFinancialRequest,
  deleteFinancialRequest,
  getRequestDetail,
  getRequestProcurementReadiness,
  listRequestsPage,
  previewFinancialRequestBudget,
  publicRequestPayload,
  requestAuthorizedCostCenters,
  requestDocumentRequirements,
  requestDocumentStatus,
  requestFormPolicy,
  submitFinancialRequest,
  updateFinancialRequest,
  voidFinancialRequest
} from "../services/requestService.js";
import { issueProcurementOrder } from "../services/purchaseOrderService.js";
import { registerA1Invoice } from "../services/invoiceRegistrationService.js";
import {
  getRenditionBankDestination,
  getRenditionPolicy,
  recoverRejectedRendition,
  reviewRendition,
  settleNonDeductibleRendition,
  submitRendition
} from "../services/renditionService.js";

export const listRequests = asyncHandler(async (req, res) => {
  const result = await listRequestsPage(req.query, req.user);
  res.json({ ...result, data: result.data.map(item => publicRequestPayload(item, req.user)) });
});

export const getRequest = asyncHandler(async (req, res) => {
  const result = await getRequestDetail(req.params.id, req.user);
  res.json({
    data: { ...publicRequestPayload(result.request, req.user), allowedActions: result.allowedActions },
    related: {
      accountsPayable: result.accountsPayable,
      journalEntries: result.journalEntries,
      paymentBatches: result.paymentBatches,
      reconciliation: result.reconciliation,
      reconciliations: result.reconciliations,
      financialProgress: result.financialProgress,
      audit: result.audit,
      budgetPreview: result.budgetPreview,
      budgetExceptions: result.budgetExceptions,
      procurementReadiness: result.procurementReadiness,
      sunatVouchers: result.sunatVouchers,
      massUploadBatches: result.massUploadBatches,
      invoiceObservations: result.invoiceObservations
    }
  });
});

export const getRequestDocumentRequirements = asyncHandler(async (req, res) => {
  res.json({ data: await requestDocumentRequirements(req.query) });
});

export const getRequestDocumentStatus = asyncHandler(async (req, res) => {
  res.json({ data: await requestDocumentStatus(req.params.id, req.user) });
});

export const getRequestFormPolicy = asyncHandler(async (req, res) => {
  res.json({ data: await requestFormPolicy(req.query) });
});

export const getAuthorizedCostCenters = asyncHandler(async (req, res) => {
  res.json({ data: await requestAuthorizedCostCenters(req.user) });
});

export const getBudgetPreview = asyncHandler(async (req, res) => {
  res.json({ data: await previewFinancialRequestBudget({ payload: req.body, user: req.user }) });
});

export const getProcurementReadiness = asyncHandler(async (req, res) => {
  res.json({ data: await getRequestProcurementReadiness(req.params.id, req.user) });
});

export const createProcurementOrder = asyncHandler(async (req, res) => {
  const order = await issueProcurementOrder({ requestId: req.params.id, user: req.user, req });
  res.status(201).json({ data: order });
});

export const createRequest = asyncHandler(async (req, res) => {
  const request = await createFinancialRequest({ payload: req.body, files: req.files, user: req.user, req });
  res.status(201).json({ data: publicRequestPayload(request, req.user) });
});

export const updateRequest = asyncHandler(async (req, res) => {
  const request = await updateFinancialRequest({ id: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(request, req.user) });
});

export const registerInvoice = asyncHandler(async (req, res) => {
  const result = await registerA1Invoice({ requestId: req.params.id, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request, req.user), sunatVoucher: result.sunatVoucher, accountsPayable: result.accountsPayable, observed: result.observed });
});

export const submitRequest = asyncHandler(async (req, res) => {
  const request = await submitFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request, req.user) });
});

export const closeRequest = asyncHandler(async (req, res) => {
  const request = await closeFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request, req.user) });
});

export const voidRequest = asyncHandler(async (req, res) => {
  const request = await voidFinancialRequest({ id: req.params.id, user: req.user, req, comments: req.body.comments });
  res.json({ data: publicRequestPayload(request, req.user) });
});

export const deleteRequest = asyncHandler(async (req, res) => {
  const request = await deleteFinancialRequest({ id: req.params.id, user: req.user, req });
  res.json({ data: publicRequestPayload(request, req.user) });
});

export const uploadRendition = asyncHandler(async (req, res) => {
  const request = await submitRendition({ requestId: req.params.id, payload: req.body, files: req.files, user: req.user, req });
  res.json({ data: publicRequestPayload(request, req.user) });
});

function renditionReviewHandler(action) {
  return asyncHandler(async (req, res) => {
    const result = await reviewRendition({ requestId: req.params.id, action, comments: req.body.comments, user: req.user, req });
    const request = result.request || result;
    res.json({ data: publicRequestPayload(request, req.user), journal: result.journal });
  });
}

export const validateRendition = renditionReviewHandler("VALIDATE");
export const observeRendition = renditionReviewHandler("OBSERVE");
export const approveRendition = renditionReviewHandler("APPROVE");
export const rejectRendition = renditionReviewHandler("REJECT");


export const settleRenditionBalance = asyncHandler(async (req, res) => {
  const result = await settleNonDeductibleRendition({ requestId: req.params.id, amount: req.body.amount, method: req.body.method, reference: req.body.reference, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request, req.user), journal: result.journal });
});

export const recoverRendition = asyncHandler(async (req, res) => {
  const result = await recoverRejectedRendition({ requestId: req.params.id, amount: req.body.amount, method: req.body.method, reference: req.body.reference, user: req.user, req });
  res.json({ data: publicRequestPayload(result.request, req.user), journal: result.journal });
});

export const getRenditionFormPolicy = asyncHandler(async (req, res) => {
  res.json({ data: await getRenditionPolicy({ requestId: req.params.id, date: req.query.date, user: req.user }) });
});

export const getRenditionPaymentDestination = asyncHandler(async (req, res) => {
  res.json({ data: await getRenditionBankDestination({ requestId: req.params.id, user: req.user }) });
});
