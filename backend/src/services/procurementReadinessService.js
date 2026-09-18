import BudgetCommitment from "../models/BudgetCommitment.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Supplier from "../models/Supplier.js";
import {
  configuredDocumentRequirements,
  configuredQuotationPolicy,
  validateDocumentRequirements,
  validateStructuredQuotationComparison
} from "./documentRuleService.js";
import { AppError } from "../utils/AppError.js";
import {
  BUDGET_STATUS,
  DOCUMENT_PHASE,
  FLOW_TYPE,
  ERROR_CODES,
  EXPENSE_NATURE,
  REQUEST_STATUS,
  REQUEST_TYPE
} from "../utils/constants.js";

const purchaseNatures = new Set([
  EXPENSE_NATURE.GOODS,
  EXPENSE_NATURE.EQUIPMENT,
  EXPENSE_NATURE.TECHNOLOGY,
  EXPENSE_NATURE.INFRASTRUCTURE,
  EXPENSE_NATURE.LABORATORIES,
  EXPENSE_NATURE.LIBRARY
]);

const serviceNatures = new Set([
  EXPENSE_NATURE.SERVICES,
  EXPENSE_NATURE.PROFESSIONAL_FEES,
  EXPENSE_NATURE.CONSULTING,
  EXPENSE_NATURE.ADVERTISING,
  EXPENSE_NATURE.MAINTENANCE
]);

const approvalCompleteStatuses = new Set([
  REQUEST_STATUS.VICE_RECTOR_APPROVED,
  REQUEST_STATUS.BUDGET_COMMITTED,
  REQUEST_STATUS.ACCOUNTED,
  REQUEST_STATUS.SCHEDULED,
  REQUEST_STATUS.BANK_FILE_GENERATED,
  REQUEST_STATUS.PAID,
  REQUEST_STATUS.RECONCILED,
  REQUEST_STATUS.CLOSED
]);

const terminalBlockedStatuses = new Set([
  REQUEST_STATUS.OBSERVED,
  REQUEST_STATUS.RETURNED,
  REQUEST_STATUS.REJECTED,
  REQUEST_STATUS.VOIDED
]);

const procurementReadyBudgetStatuses = new Set([
  BUDGET_STATUS.COMMITTED,
  BUDGET_STATUS.NO_BUDGET
]);

function issue(code, message, details) {
  return { code, message, details };
}

export function orderKindForRequest(request) {
  if (purchaseNatures.has(request.expenseNature)) return "PURCHASE";
  if (serviceNatures.has(request.expenseNature)) return "SERVICE";
  return null;
}

async function loadSupplier(request) {
  if (request.supplier?.homologationStatus) return request.supplier;
  return Supplier.findById(request.supplier);
}

async function loadCommitment(request, session, suppliedCommitment) {
  if (suppliedCommitment) return suppliedCommitment;
  if (request.budgetCommitment?.status) return request.budgetCommitment;
  if (!request.budgetCommitment) return null;
  return BudgetCommitment.findById(request.budgetCommitment).session(session || null);
}

export async function evaluateProcurementReadiness(request, { session, commitment: suppliedCommitment } = {}) {
  const [supplier, commitment, quotationPolicy, requirements, existingOrder] = await Promise.all([
    loadSupplier(request),
    loadCommitment(request, session, suppliedCommitment),
    configuredQuotationPolicy(request),
    configuredDocumentRequirements(request, DOCUMENT_PHASE.PROCUREMENT),
    PurchaseOrder.findOne({ request: request._id }).session(session || null)
  ]);
  const quotationResult = validateStructuredQuotationComparison(request, quotationPolicy);
  const documentResult = validateDocumentRequirements(request, requirements);
  const orderKind = orderKindForRequest(request);
  const procurementType = [REQUEST_TYPE.OPEX, REQUEST_TYPE.CAPEX, REQUEST_TYPE.PAGO_CON_COTIZACION].includes(request.requestType);
  const applicable = request.flowType === FLOW_TYPE.A1 && procurementType && Boolean(orderKind);
  const issues = [];

  if (!applicable) {
    issues.push(issue(ERROR_CODES.PROCUREMENT_NOT_APPLICABLE, "This request does not require a Purchase or Service Order.", { requestType: request.requestType, quotationPolicyEnabled: quotationPolicy.enabled }));
  }
  if (procurementType && !orderKind && (request.requestType === REQUEST_TYPE.PAGO_CON_COTIZACION || quotationPolicy.enabled)) {
    issues.push(issue(ERROR_CODES.ORDER_KIND_UNDETERMINED, "The controlled expense nature does not identify a Purchase or Service Order kind.", { expenseNature: request.expenseNature }));
  }
  if (!approvalCompleteStatuses.has(request.status) || (request.approvalRouteSnapshot || []).some((step) => step.required !== false && step.status !== "APPROVED")) {
    issues.push(issue(ERROR_CODES.REQUEST_APPROVAL_PENDING, "All configured request approvals must be complete.", { status: request.status, approvalStage: request.approvalStage }));
  }
  if (terminalBlockedStatuses.has(request.status)) {
    issues.push(issue(ERROR_CODES.INVALID_STATUS_TRANSITION, "Observed, returned, rejected, or annulled requests are not procurement-ready.", { status: request.status }));
  }
  if (!commitment || !procurementReadyBudgetStatuses.has(commitment.status)) {
    issues.push(issue(ERROR_CODES.BUDGET_NOT_COMMITTED, "A committed Budget record is required before order execution.", { budgetStatus: commitment?.status || "NO_BUDGET" }));
  }

  if (!supplier) {
    issues.push(issue(ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED, "The recommended supplier record is missing."));
  } else if (supplier.homologationStatus === "PENDING_VALIDATION") {
    issues.push(issue(ERROR_CODES.SUPPLIER_HOMOLOGATION_PENDING, "Supplier homologation is pending.", { supplier: supplier._id }));
  } else if (supplier.homologationStatus === "OBSERVED") {
    issues.push(issue(ERROR_CODES.SUPPLIER_HOMOLOGATION_OBSERVED, "Supplier homologation is observed and must be corrected in Supplier Master.", { supplier: supplier._id }));
  } else if (supplier.homologationStatus === "REJECTED" || supplier.status === "REJECTED") {
    issues.push(issue(ERROR_CODES.SUPPLIER_REJECTED, "The recommended supplier was rejected.", { supplier: supplier._id }));
  } else if (!supplier.active || supplier.homologationStatus === "INACTIVE" || supplier.status === "INACTIVE") {
    issues.push(issue(ERROR_CODES.SUPPLIER_INACTIVE, "The recommended supplier is inactive.", { supplier: supplier._id }));
  } else if (supplier.homologationStatus !== "HOMOLOGATED") {
    issues.push(issue(ERROR_CODES.SUPPLIER_NOT_HOMOLOGATED, "The recommended supplier is not homologated.", { supplier: supplier._id }));
  }
  if (supplier && !supplier.supplierCode) {
    issues.push(issue(ERROR_CODES.SUPPLIER_PRV_MISSING, "The homologated supplier has no assigned PRV code.", { supplier: supplier._id }));
  }
  if (applicable && !quotationResult.valid) {
    issues.push(issue(ERROR_CODES.QUOTATION_REQUIREMENTS_INCOMPLETE, "The configured quotation comparison is incomplete.", { errors: quotationResult.errors, policy: quotationPolicy }));
  }
  if (applicable && !documentResult.valid) {
    issues.push(issue(ERROR_CODES.MISSING_REQUIRED_DOCUMENT, "Mandatory procurement evidence is incomplete.", { missing: documentResult.missing }));
  }

  const blockingIssues = issues.filter((item) => item.code !== ERROR_CODES.PROCUREMENT_NOT_APPLICABLE);
  return {
    applicable,
    ready: applicable && blockingIssues.length === 0,
    readyForOrderCreation: applicable && blockingIssues.length === 0 && !existingOrder,
    orderKind,
    existingOrder,
    supplier: supplier ? {
      id: supplier._id,
      legalName: supplier.legalName || supplier.name,
      identifier: supplier.normalizedIdentifier || supplier.rucDni,
      homologationStatus: supplier.homologationStatus,
      operationalStatus: supplier.status,
      active: supplier.active,
      supplierCode: supplier.supplierCode
    } : null,
    approval: {
      complete: approvalCompleteStatuses.has(request.status) && !(request.approvalRouteSnapshot || []).some((step) => step.required !== false && step.status !== "APPROVED"),
      stage: request.approvalStage,
      status: request.status
    },
    budget: { complete: procurementReadyBudgetStatuses.has(commitment?.status), status: commitment?.status || BUDGET_STATUS.NO_BUDGET, commitment: commitment?._id || null },
    quotations: { complete: quotationResult.valid, policy: quotationPolicy, errors: quotationResult.errors },
    documents: { complete: documentResult.valid, missing: documentResult.missing },
    issues
  };
}

export async function assertProcurementReady(request, options) {
  const readiness = await evaluateProcurementReadiness(request, options);
  if (!readiness.applicable) {
    throw new AppError(422, "This request is not eligible for a Purchase or Service Order.", { readiness }, ERROR_CODES.PROCUREMENT_NOT_APPLICABLE);
  }
  if (!readiness.ready) {
    throw new AppError(422, "The request is not ready for procurement execution.", { readiness, issues: readiness.issues }, ERROR_CODES.PROCUREMENT_NOT_READY);
  }
  return readiness;
}
