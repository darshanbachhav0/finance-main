import Supplier from "../models/Supplier.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import { assertTrackEligible, parseRequestLines, getRequestDetail, previewFinancialRequestBudget } from "./requestService.js";
import { documentStatusByPhase, configuredQuotationPolicy, validateStructuredQuotationComparison } from "./documentRuleService.js";
import { assertSupplierEligibleForRequestReview } from "./supplierService.js";
import { activeApprovalStep } from "./approvalRuleService.js";
import { assertClosureAllowed } from "./financialProgressService.js";
import { AppError } from "../utils/AppError.js";

export async function submissionReadiness(payload, user) {
  if (!["Admin", "Solicitor"].includes(user.role)) throw new AppError(403, "Request preparation is not available for this role.");
  const request = { ...payload, requesterArea: user.role === "Admin" ? payload.requesterArea || user.area : user.area, status: "BORRADOR" };
  request.lines = Array.isArray(payload.lines) ? payload.lines : [];
  request.attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  request.quotations = Array.isArray(payload.quotations) ? payload.quotations : [];
  const issues = [];
  const add = (code, message, owner = "Requester", path = "/requests/new", details) => issues.push({ code, message, owner, path, details });
  for (const field of ["title", "expenseNature", "issueDate", "accountingPeriod"]) if (!request[field]) add("REQUIRED", `Complete ${field}.`);
  const period = await AccountingPeriod.findOne({ period: request.accountingPeriod }).lean();
  if (!period) add("PERIOD_MISSING", "Configure the accounting period.", "Accounting", "/accounting/periods");
  else if (period.status === "CLOSED" && period.policy?.blockUpdate !== false) add("PERIOD_CLOSED", "The accounting period does not permit submission.", "Accounting", "/accounting/periods");
  if (request.flowType !== "C") {
    const supplier = request.supplier ? await Supplier.findById(request.supplier) : null;
    if (!supplier) add("SUPPLIER_REQUIRED", "Select a supplier.");
    else try { assertSupplierEligibleForRequestReview(supplier); } catch (error) { add(error.code, error.message, "Accounting / Requester", "/suppliers"); }
  }
  const documents = await documentStatusByPhase(request);
  for (const missing of documents.phases.SUBMISSION.missing) add("MISSING_DOCUMENT", `Upload ${missing.label || missing.kind}: ${missing.present}/${missing.required}.`);
  const quotation = validateStructuredQuotationComparison(request, await configuredQuotationPolicy(request));
  if (!quotation.valid) add("QUOTATIONS_INCOMPLETE", "Complete quotation evidence and comparison.", "Requester", "/requests/new", quotation.errors);
  let budget;
  try { budget = await previewFinancialRequestBudget({ payload: request, user }); }
  catch (error) { if (!error.statusCode) throw error; add(error.code, error.message, "Requester / Budget", "/budget", error.details); }
  if (budget?.exchangeRate) request.exchangeRate = budget.exchangeRate;
  try { request.lines = parseRequestLines(request.lines); } catch (error) { add("LINES_INVALID", error.message); }
  if (budget?.status === "PENDING_VALIDATION") add("BUDGET_PENDING", "Budget or exchange-rate information is incomplete.", "Budget / Accounting", "/budget");
  if (budget?.status === "INSUFFICIENT") add("BUDGET_SHORTFALL", "Budget is insufficient. Budget review and any required Management exception must be completed before accounting.", "Budget / Management", "/budget");
  // Amounts are recomputed from submitted lines, never trusted as a claimed total.
  try { await assertTrackEligible(request); } catch (error) { if (!error.statusCode) throw error; add(error.code, error.message, "Admin", "/configuration/direct-payment-eligibility", error.details); }
  return { issues, documents, budget, ready: issues.length === 0, checkedAt: new Date(), informational: true };
}

export async function requestReadiness(id, user) {
  const detail = await getRequestDetail(id, user); // Enforces current record access.
  const request = detail.request;
  const documents = await documentStatusByPhase(request);
  const issues = [];
  const path = `/requests/${id}`;
  if (["CERRADO", "RECHAZADO", "ANULADO", "PAGADO_CERRADO"].includes(request.status)) return { issues: [], next: { message: "This request is terminal; no workflow action is pending.", owner: "None", path }, checkedAt: new Date() };
  for (const missing of documents.phases[documents.currentPhase].missing) issues.push({ code: "DOCUMENT", message: `Upload ${missing.label || missing.kind}: ${missing.present}/${missing.required}.`, owner: documents.currentPhase === "ACCOUNTING" ? "Accounting" : "Requester", path });
  if (request.observation?.code && !request.observation.resolvedAt) issues.push({ code: request.observation.code, message: request.observation.detail, owner: "Accounting / Requester", path });
  for (const item of detail.budgetExceptions.filter(row => ["PENDING", "REVIEWED"].includes(row.status))) issues.push({ code: "BUDGET_EXCEPTION", message: "Budget exception requires an authorized decision.", owner: "Management", path: "/budget" });
  if (request.flowType === "A1" && !request.purchaseOrder && ["APROBADO", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR", "COMPROMISO_PRESUPUESTAL"].includes(request.status)) issues.push(...(detail.procurementReadiness?.issues || []).map(item => ({ ...item, owner: "Procurement / Budget", path })));
  for (const voucher of detail.sunatVouchers || []) {
    if (voucher.supersededBy || ["VALID", "MANUAL_EXCEPTION", "ANNULLED"].includes(voucher.validationStatus)) continue;
    issues.push({ code: "INVOICE_VALIDATION", message: `${voucher.seriesNumber}: ${voucher.observationDetail || "Individual voucher validation is pending."}`, owner: "Accounting / Requester", path });
  }
  for (const observation of detail.invoiceObservations || []) if (observation.resolutionStatus === "OPEN") issues.push({ code: "INVOICE_OBSERVATION", message: observation.errorDetail || "Resolve the open invoice observation.", owner: "Accounting / Requester", path });
  if (["COMPROMISO_PRESUPUESTAL", "OBSERVADO_SUNAT", "OBSERVADO_LOTE"].includes(request.status)) {
    const period = await AccountingPeriod.findOne({ period: request.accountingPeriod }).lean();
    if (!period || period.status === "CLOSED") issues.push({ code: "ACCOUNTING_PERIOD", message: "Accounting requires a configured open posting period.", owner: "Accounting", path });
  }
  const step = activeApprovalStep(request);
  let next = step ? { message: "Waiting for approval.", owner: step.approverSnapshot?.name || step.role || "Assigned jefe", path } : { message: "Review the current requirements and available actions.", owner: "Responsible Finance role", path };
  const stages = {
    BORRADOR: ["Complete evidence and submit the request.", "Requester"],
    DEVUELTO: ["Correct the observations and resubmit.", "Requester"],
    COMPROMISO_PRESUPUESTAL: ["Complete invoice and accounting checks.", "Accounting / Requester"],
    CONTABILIZADO: ["Prepare the payment batch.", "Treasury"],
    PROGRAMADO: ["Review and generate the BBVA payment file.", "Treasury"],
    TXT_GENERADO: ["Confirm payment only after bank execution.", "Treasury"],
    PAGADO: ["Reconcile the confirmed payment with bank evidence.", "Treasury"]
  };
  if (!step && stages[request.status]) next = { message: stages[request.status][0], owner: stages[request.status][1], path };
  if (detail.allowedActions.includes("ISSUE_ORDER")) next = { message: "Issue the purchase or service order.", owner: "Procurement", path };
  else if (detail.allowedActions.includes("REGISTER_INVOICE")) next = { message: "Register invoice evidence for accounting review.", owner: "Requester / Accounting", path };
  if (request.status === "CONCILIADO") {
    try {
      await assertClosureAllowed(request);
      const period = await AccountingPeriod.findOne({ period: request.accountingPeriod }).lean();
      if (!period || (period.status === "CLOSED" && period.policy?.blockClose !== false)) throw new AppError(422, "The accounting period does not permit closure.");
      next = { message: "Ready for authorized closure.", owner: "Accounting / Admin", path };
    } catch (error) { if (!error.statusCode) throw error; issues.push({ code: "CLOSURE", message: error.message, owner: "Accounting", path }); }
  }
  return { issues, next, documents, checkedAt: new Date(), allowedActions: detail.allowedActions };
}
