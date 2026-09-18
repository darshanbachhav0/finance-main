import { canonicalRequestStatus, isTerminalRequest, renditionPending } from "../../../shared/workflowStatus.mjs";
import { canApproveStage, canViewRequest } from "../utils/permissions.js";

export const idOf = (value) => String(value?._id || value || "");
const FINANCE = ["Accounting", "Admin"];
const ownerOf = (record) => idOf(record.requester || record.solicitor);
const approvedStates = ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR", "ENVIADO", "EN_VALIDACION"];
export function taskBlueprints(type, record, related = {}) {
  if (!record) return [];
  const request = type === "FinancialRequest" ? record : related.request;
  if (request && isTerminalRequest(request.status)) return [];
  const owner = type === "EmployeeReimbursementBankAccount" ? idOf(record.user)
    : type === "Supplier" ? idOf(record.proposedBy)
    : type === "SupplierBankAccount" ? idOf(related.supplier?.proposedBy || record.createdBy)
    : ownerOf(request || {}) || idOf(record.requestedBy || record.uploadedBy);
  const base = {
    entityType: type, entityId: idOf(record), requestId: idOf(request),
    owner: owner || undefined, reference: record.requestNumber || record.batchCode || record.supplierCode || request?.requestNumber || record.name || record.bank || type,
    sourceStatus: record.verificationStatus || record.homologationStatus || record.resolutionStatus || record.status,
    waitingSince: record.createdAt || new Date(),
    path: request ? `/requests/${idOf(request)}` : type === "EmployeeReimbursementBankAccount" ? `/reimbursement-bank?record=${idOf(record)}` : `/suppliers?record=${idOf(related.supplier || record)}`,
    comments: record.verificationComments || record.reviewComments || record.comments || record.resolutionComments || request?.rendition?.financeReview?.comments || request?.approvalHistory?.at(-1)?.comments || ""
  };
  const tasks = [];
  const add = (stage, team, action, roles, extra = {}) => tasks.push({ ...base, stage, team, action, roles, module: team, ...extra });
  const correction = (stage, module) => add(stage, "Submitter", "Correct and resubmit", [], { directUser: owner, module });
  if (type === "EmployeeReimbursementBankAccount" || type === "SupplierBankAccount") {
    if (!record.active) return [];
    if (record.verificationStatus === "PENDING") add("bank-review", "Accounting", "Verify bank profile", FINANCE, { module: "Banking" });
    if (["OBSERVED", "REJECTED"].includes(record.verificationStatus)) correction("bank-correction", "Banking");
  }
  if (type === "Supplier") {
    if (record.homologationStatus === "PENDING_VALIDATION") {
      if (record.taxpayerValidation?.status !== "VALID") add("supplier-tax", "Accounting", "Review taxpayer validation", FINANCE, { module: "Suppliers" });
      if (record.complianceReview?.result !== "APPROVED") add("supplier-compliance", "Accounting", "Review supplier compliance", FINANCE, { module: "Suppliers" });
      if (record.taxpayerValidation?.status === "VALID" && record.complianceReview?.result === "APPROVED") add("supplier-homologation", "Accounting", "Review homologation requirements", FINANCE, { module: "Suppliers" });
    }
    if (record.homologationStatus === "OBSERVED") correction("supplier-correction", "Suppliers");
  }
  if (type === "BudgetException" && record.status === "PENDING") add("budget-exception", record.preparedAt ? "Management" : "Budget", record.preparedAt ? "Decide budget exception" : "Review budget exception", record.preparedAt ? ["Management"] : ["Budget", "Admin"], { module: "Budget", path: `/budget?record=${idOf(record)}` });
  if (type === "InvoiceObservation" && record.resolutionStatus === "OPEN") add("invoice-correction", "Accounting", "Revalidate observed invoice", FINANCE, { module: "Accounting", path: `/accounting/invoice-observations?record=${idOf(record)}` });
  if (type === "AccountsPayable") {
    if (["OPEN", "SCHEDULED", "PAYMENT_BOUNCED"].includes(record.status)) add("payment-processing", "Treasury", "Prepare or reprogram payment", ["Treasury", "Admin"], { module: "Payments", dueAt: record.dueDate, path: `/treasury?record=${idOf(record)}` });
    if (record.status === "PAYMENT_FILE_CREATED") add("payment-confirmation", "Treasury", "Confirm bank payment", ["Treasury", "Admin"], { module: "Payments", dueAt: record.dueDate, path: `/treasury?record=${idOf(record)}` });
  }
  if (type === "MassUploadBatch" && record.status === "FAILED") add("batch-retry", "Accounting", "Review failed invoice batch", FINANCE, { module: "Accounting", path: `/batch-invoices?request=${idOf(request)}` });
  if (type === "FinancialRequest") {
    if (record.status === "BORRADOR") return [];
    const step = [...(record.approvalRouteSnapshot || [])].sort((a,b) => a.sequence-b.sequence).find((s) => s.required !== false && s.status === "PENDING");
    if (approvedStates.includes(record.status) && step) add(`approval-${step.approvalLevel}-${new Date(step.startedAt || record.createdAt).getTime()}`, step.approvalLevel, "Review request approval", [step.role || "Approver"], { module: "Approvals", approval: true, step, waitingSince: step.startedAt || record.createdAt, dueAt: step.dueAt || record.approvalDueAt });
    else if (["APROBADO_VICERRECTOR", "APROBADO_DIRECTOR"].includes(record.status)) add("budget-commit", "Budget", "Review and commit budget", ["Budget", "Admin"]);
    if (record.status === "OBSERVADO_PRESUPUESTO") add("budget-adjustment", "Budget", "Review budget availability", ["Budget", "Admin"]);
    else if (["OBSERVADO", "DEVUELTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA"].includes(record.status)) correction("request-correction", "Requests");
    const rendition = record.rendition || {};
    if (rendition.status === "SUBMITTED") add("rendition-review", "Accounting", "Review submitted rendition", FINANCE, { module: "Renditions", waitingSince: rendition.submittedAt || record.updatedAt });
    else if (renditionPending(record) || (record.status === "COMPROMISO_PRESUPUESTAL" && record.requestType === "REEMBOLSO_SIN_SUSTENTO")) {
      if (rendition.status !== "VALIDATED") add("rendition-submit", "Submitter", "Submit or correct rendition", [], { directUser: owner, module: "Renditions", dueAt: rendition.dueDate });
    }
    if (record.status === "COMPROMISO_PRESUPUESTAL" && !["REEMBOLSO_SIN_SUSTENTO"].includes(record.requestType)) {
      if (["A1", "A2"].includes(record.flowType) && !record.purchaseOrder) add("purchase-order", "Budget", "Issue approved purchase order", ["Budget", "Admin"]);
      else add("accounting-process", "Accounting", record.flowType === "A2" ? "Register batch invoices" : "Process accounting documents", FINANCE);
    }
    if (canonicalRequestStatus(record.status) === "PAGADO") add("reconcile", "Treasury", "Reconcile payment", ["Treasury", "Admin"], { module: "Payments" });
    if (record.status === "CONCILIADO") add("close", "Accounting", "Review and close request", FINANCE);
    if (rendition.nonDeductibleOutstanding > 0) add("rendition-regularization", "Accounting", "Review outstanding rendition balance", FINANCE, { module: "Renditions" });
  }
  return tasks;
}
export function eligibleForTask(task, user, record) {
  if (!user?.active) return false;
  if (task.directUser) return idOf(user) === idOf(task.directUser);
  if (task.approval) {
    if (idOf(user) === task.owner) return false;
    if (user.role === "Admin") return true;
    if (!task.roles.includes(user.role) || !canApproveStage(record, user)) return false;
    if (task.step.approvalLevel === "AREA_DIRECTOR") {
      const areas = [user.area, ...(user.approvalAreas || [])];
      return !record.requesterArea && !record.requestingArea || areas.includes("*") || areas.includes(record.requesterArea || record.requestingArea);
    }
    return true;
  }
  return task.roles.includes(user.role);
}
export function mayViewTaskEntity(type, record, user, related = {}) {
  if (!record || !user?.active) return false;
  if (type === "FinancialRequest") return canViewRequest(record, user);
  if (type === "EmployeeReimbursementBankAccount") return ["Accounting","Admin","Treasury"].includes(user.role) || idOf(record.user) === idOf(user);
  if (["Supplier","SupplierBankAccount"].includes(type)) return ["Accounting","Admin","Treasury"].includes(user.role) || (user.role === "Solicitor" && idOf((related.supplier || record).proposedBy) === idOf(user));
  if (related.request && canViewRequest(related.request, user)) return true;
  return user.role === "Admin";
}
