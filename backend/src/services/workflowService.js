import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { assertClosureAllowed, getFinancialProgress, assertPostingAllowed } from "./financialProgressService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import { recordAudit, workflowEvent } from "./auditService.js";
import { ensurePeriodOpen } from "./periodService.js";
import { assertRequestLines } from "./requestRules.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { AppError } from "../utils/AppError.js";
import {
  APPROVAL_STAGES,
  DOCUMENT_PHASE,
  ERROR_CODES,
  FLOW_TYPE,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";

const observationStates = [
  REQUEST_STATUS.OBSERVED,
  REQUEST_STATUS.OBSERVED_BUDGET,
  REQUEST_STATUS.OBSERVED_SUNAT,
  REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED,
  REQUEST_STATUS.OBSERVED_BATCH
];

const transitionGraph = Object.freeze({
  BORRADOR: ["PENDIENTE_APROBACION", "ANULADO"],
  PENDIENTE_APROBACION: ["APROBADO_DIRECTOR", "APROBADO", ...observationStates, "DEVUELTO", "RECHAZADO", "ANULADO"],
  APROBADO_DIRECTOR: ["APROBADO_VICERRECTOR", "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", ...observationStates, "DEVUELTO", "RECHAZADO", "ANULADO"],
  APROBADO_VICERRECTOR: ["COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", ...observationStates, "DEVUELTO", "RECHAZADO", "ANULADO"],
  APROBADO: ["COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", ...observationStates, "DEVUELTO", "RECHAZADO", "ANULADO"],
  COMPROMISO_PRESUPUESTAL: ["CONTABILIZADO", ...observationStates, "DEVUELTO", "ANULADO"],
  CONTABILIZADO: ["PROGRAMADO", ...observationStates, "ANULADO"],
  PROGRAMADO: ["TXT_GENERADO", "CONTABILIZADO", "PAGO_REBOTADO", "ANULADO"],
  TXT_GENERADO: ["PAGADO", "PAGO_REBOTADO", "ANULADO"],
  PAGO_REBOTADO: ["CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "ANULADO"],
  PAGADO: ["CONCILIADO"],
  CONCILIADO: ["CERRADO"],
  CERRADO: [], RECHAZADO: [], ANULADO: [],
  ...Object.fromEntries([...observationStates, "DEVUELTO"].map(status => [status,
    ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR", "APROBADO", "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "DEVUELTO", "RECHAZADO", "ANULADO"]]))
});

const roleTargets = Object.freeze({
  [REQUEST_STATUS.VALIDATION]: [ROLES.ADMIN, ROLES.SOLICITOR],
  [REQUEST_STATUS.SENT]: [ROLES.ADMIN, ROLES.SOLICITOR],
  [REQUEST_STATUS.PENDING_APPROVAL]: [ROLES.ADMIN, ROLES.SOLICITOR],
  [REQUEST_STATUS.DIRECTOR_APPROVED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT],
  [REQUEST_STATUS.VICE_RECTOR_APPROVED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT],
  [REQUEST_STATUS.APPROVED]: [ROLES.ADMIN],
  [REQUEST_STATUS.BUDGET_COMMITTED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.BUDGET, ROLES.ACCOUNTING],
  [REQUEST_STATUS.ACCOUNTED]: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.BUDGET, ROLES.SOLICITOR],
  [REQUEST_STATUS.SCHEDULED]: [ROLES.ADMIN, ROLES.TREASURY],
  [REQUEST_STATUS.BANK_FILE_GENERATED]: [ROLES.ADMIN, ROLES.TREASURY],
  [REQUEST_STATUS.PAYMENT_BOUNCED]: [ROLES.ADMIN, ROLES.TREASURY],
  [REQUEST_STATUS.PAID]: [ROLES.ADMIN, ROLES.TREASURY],
  [REQUEST_STATUS.RECONCILED]: [ROLES.ADMIN, ROLES.TREASURY, ROLES.ACCOUNTING],
  [REQUEST_STATUS.CLOSED]: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY],
  [REQUEST_STATUS.OBSERVED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT, ROLES.ACCOUNTING],
  [REQUEST_STATUS.OBSERVED_BUDGET]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT, ROLES.BUDGET, ROLES.ACCOUNTING],
  [REQUEST_STATUS.OBSERVED_SUNAT]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT, ROLES.ACCOUNTING, ROLES.SOLICITOR],
  [REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED]: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.BUDGET, ROLES.SOLICITOR],
  [REQUEST_STATUS.OBSERVED_BATCH]: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SOLICITOR],
  [REQUEST_STATUS.RETURNED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT, ROLES.ACCOUNTING],
  [REQUEST_STATUS.REJECTED]: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT],
  [REQUEST_STATUS.VOIDED]: [ROLES.ADMIN, ROLES.ACCOUNTING]
});

export function allowedTransitions(status) { return [...(transitionGraph[canonicalRequestStatus(status)] || [])]; }
export function canTransition(from, to) { return allowedTransitions(from).includes(canonicalRequestStatus(to)); }

function requesterId(request) {
  return String(request.requester?._id || request.requester || request.solicitor?._id || request.solicitor || "");
}

function requiresFiscalXml(request) {
  // A1 invoices are attached only after the PO is issued and conformity is
  // recorded. The request approval gate requires fiscal XML only for Track B.
  return request.flowType === FLOW_TYPE.B;
}

function assertTransitionPermission(request, targetStatus, user, { approvalStage, adminOverrideReason, skipRoleCheck = false } = {}) {
  if (String(adminOverrideReason || "").trim()) throw new AppError(403, "Emergency approval overrides are disabled. Use the assigned approval route.");
  if (!user) throw new AppError(401, "Authentication is required.", undefined, ERROR_CODES.FORBIDDEN);
  const allowedRoles = roleTargets[targetStatus] || [];
  if (!skipRoleCheck && !allowedRoles.includes(user.role)) throw new AppError(403, "You do not have permission for this workflow transition.", { targetStatus }, ERROR_CODES.FORBIDDEN);

  if ([REQUEST_STATUS.VALIDATION, REQUEST_STATUS.SENT, REQUEST_STATUS.PENDING_APPROVAL].includes(targetStatus)) {
    if (user.role !== ROLES.ADMIN && requesterId(request) !== String(user._id)) throw new AppError(403, "Only the requester can submit this request.", undefined, ERROR_CODES.FORBIDDEN);
  }

  if ([REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED].includes(targetStatus)) {
    const expectedStage = targetStatus === REQUEST_STATUS.DIRECTOR_APPROVED ? APPROVAL_STAGES.AREA_DIRECTOR : APPROVAL_STAGES.VICE_RECTOR;
    const currentStage = approvalStage || request.approvalStage || APPROVAL_STAGES.AREA_DIRECTOR;
    if (currentStage !== expectedStage) throw new AppError(409, "This request is assigned to a different approval level.", { expectedStage, currentStage }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    if (requesterId(request) === String(user._id)) {
      throw new AppError(403, "A requester cannot approve their own request.", { segregationOfDuties: true }, ERROR_CODES.FORBIDDEN);
    }
    if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR].includes(user.role) && (user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR) !== expectedStage) throw new AppError(403, "This approval belongs to a different approval level.", { expectedStage }, ERROR_CODES.FORBIDDEN);
  }
}

async function assertTransitionControls(request, targetStatus, context = {}) {
  await ensurePeriodOpen(request.accountingPeriod, {
    action: context.periodAction || "UPDATE", user: context.user, req: context.req, module: "WORKFLOW",
    entityType: "FinancialRequest", entityId: request._id, requestId: request._id
  });
  assertRequestLines(request.lines);

  const supplierNotRequired = request.flowType === FLOW_TYPE.C;
  if (!supplierNotRequired && ![
    REQUEST_STATUS.DRAFT, REQUEST_STATUS.VALIDATION, REQUEST_STATUS.SENT, REQUEST_STATUS.PENDING_APPROVAL,
    REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.APPROVED, REQUEST_STATUS.VOIDED,
    ...observationStates
  ].includes(targetStatus)) {
    const supplier = request.supplier?.homologationStatus ? request.supplier : await Supplier.findById(request.supplier);
    const valid = supplier && ((supplier.homologationStatus === "HOMOLOGATED" && supplier.active) || supplier.status === "ACTIVE");
    if (!valid) throw new AppError(422, "The supplier is not active and homologated.", { supplier: request.supplier }, ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED);
  }

  if ([REQUEST_STATUS.SENT, REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.APPROVED, REQUEST_STATUS.BUDGET_COMMITTED].includes(targetStatus)) {
    await assertConfiguredDocuments(request, DOCUMENT_PHASE.SUBMISSION);
    if (requiresFiscalXml(request) && !request.xmlValidation?.validated) throw new AppError(422, "A valid XML fiscal document is required.", { requestType: request.requestType, flowType: request.flowType }, ERROR_CODES.XML_VALIDATION_FAILED);
  }

  if (targetStatus === REQUEST_STATUS.BUDGET_COMMITTED && !request.budgetCommitment) throw new AppError(422, "A budget commitment is required before this transition.", undefined, ERROR_CODES.INSUFFICIENT_BUDGET);
  if (targetStatus === REQUEST_STATUS.ACCOUNTED) await assertConfiguredDocuments(request, DOCUMENT_PHASE.ACCOUNTING);
  if (targetStatus === REQUEST_STATUS.ACCOUNTED && (!request.fiscalData?.processedAt || !request.accountsPayable)) throw new AppError(422, "Fiscal processing and Accounts Payable creation are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (targetStatus === REQUEST_STATUS.ACCOUNTED && !(request.accountsPayable || request.accountsPayables?.length)) throw new AppError(422, "At least one Accounts Payable record is required before provisioning.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (targetStatus === REQUEST_STATUS.SCHEDULED && !(request.accountsPayable || request.accountsPayables?.length)) throw new AppError(422, "An open Accounts Payable record is required before Treasury scheduling.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (targetStatus === REQUEST_STATUS.BANK_FILE_GENERATED && !request.paymentBatch && request.flowType !== FLOW_TYPE.A2) throw new AppError(422, "A persisted payment batch is required before TXT_GENERADO.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (targetStatus === REQUEST_STATUS.PAID && (!request.payment?.confirmedAt || !request.payment?.operationNumber) && request.flowType !== FLOW_TYPE.A2) throw new AppError(422, "Actual Treasury payment confirmation is required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (targetStatus === REQUEST_STATUS.RECONCILED && !request.reconciliation) throw new AppError(422, "A reconciliation record is required before CONCILIADO.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const renditionResolved = request.rendition?.status === "VALIDATED"
    || (request.rendition?.status === "REJECTED" && request.rendition?.recovery?.status === "RECOVERED");
  if (targetStatus === REQUEST_STATUS.CLOSED && request.requestType === REQUEST_TYPE.ENTREGA_RENDIR && !renditionResolved) throw new AppError(422, "A validated rendition, or full recovery of a rejected rendition's advance, is required before closure.", undefined, ERROR_CODES.RENDITION_REQUIRED);
  if (targetStatus === REQUEST_STATUS.CLOSED && Number(request.rendition?.nonDeductibleOutstanding || 0) > 0) throw new AppError(422, "Non-deductible rendition balances must be reimbursed or assigned to payroll before closure.", { nonDeductibleOutstanding: request.rendition?.nonDeductibleOutstanding }, ERROR_CODES.RENDITION_REQUIRED);
}

export async function transitionRequest({ request, targetStatus, user, req, action, comments, approvalStage, nextApprovalStage, dueAt, adminOverrideReason, eventDueAt, skipControls = false, skipRoleCheck = false, session }) {
  const originalStatus = request.status;
  const from = canonicalRequestStatus(originalStatus);
  targetStatus = canonicalRequestStatus(targetStatus);
  if (isTerminalRequest(from)) throw new AppError(409, "Terminal requests cannot transition.", { from, to: targetStatus }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  if (from === targetStatus) return request;
  if (!canTransition(from, targetStatus)) throw new AppError(409, `Invalid request status transition from ${from} to ${targetStatus}.`, { from, to: targetStatus, allowed: allowedTransitions(from) }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  assertTransitionPermission(request, targetStatus, user, { approvalStage, adminOverrideReason, skipRoleCheck });
  // Period and financial evidence are mandatory, including internal recovery/batch calls.
  await ensurePeriodOpen(request.accountingPeriod, { user, req, action: "UPDATE", requestId: request._id });
  if (targetStatus === "CONTABILIZADO") await assertPostingAllowed(request, { user, req });
  if (["CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO"].includes(targetStatus)) {
    const progress = await getFinancialProgress(request, { session });
    const stages = ["CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO"];
    if (!progress.status || stages.indexOf(progress.status) < stages.indexOf(targetStatus)) throw new AppError(422, "Child financial evidence does not satisfy this milestone.", progress, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (targetStatus === "CERRADO") await assertClosureAllowed(request, { session });
  if (!skipControls) await assertTransitionControls(request, targetStatus, { user, req, periodAction: [REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.APPROVED].includes(targetStatus) ? "APPROVE" : undefined });

  const oldValues = { status: from, approvalStage: request.approvalStage, approvalDueAt: request.approvalDueAt };
  const previousDueAt = request.approvalDueAt;

  if (originalStatus !== from) request.legacyWorkflowStatus ||= originalStatus;
  request.workflowVersion = 2;
  request.status = targetStatus;
  if (nextApprovalStage !== undefined) request.approvalStage = nextApprovalStage;
  if (dueAt !== undefined) request.approvalDueAt = dueAt;
  request.approvalHistory.push(workflowEvent({ action: action || targetStatus, from, to: targetStatus, user, req, comments: adminOverrideReason ? `${comments || ""} Admin override: ${adminOverrideReason}`.trim() : comments, stage: approvalStage || request.approvalStage, dueAt: eventDueAt === undefined ? previousDueAt : eventDueAt, request }));
  await request.save({ session });
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: action || "STATUS_TRANSITION", user, req, comments, module: "WORKFLOW", oldValues, newValues: { status: targetStatus, approvalStage: request.approvalStage, approvalDueAt: request.approvalDueAt }, changes: { from, to: targetStatus }, session });
  return request;
}

export async function loadRequestForTransition(id, populate = []) {
  const query = FinancialRequest.findById(id);
  if (populate.length) query.populate(populate);
  const request = await query;
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  return request;
}
