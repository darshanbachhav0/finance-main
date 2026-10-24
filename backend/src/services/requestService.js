import BudgetException from "../models/BudgetException.js";
import { advanceReturnAccount } from "./advancePaymentService.js";
import { runFinancialOperation } from "./transactionService.js";
import { assertRequestActive, assertClosureAllowed, getFinancialProgress, getFinancialProgressForRequests } from "./financialProgressService.js";
import { canonicalRequestStatus, renditionSettledForClosure, statusAliases, terminalStatusValues } from "../../../shared/workflowStatus.mjs";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import CostCenter from "../models/CostCenter.js";
import Project from "../models/Project.js";
import AuditLog from "../models/AuditLog.js";
import AccountsPayable from "../models/AccountsPayable.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Reconciliation from "../models/Reconciliation.js";
import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";
import { COST_CENTER_TYPE, COST_CENTER_TYPES, costAllocationProblems } from "../../../shared/costCenterAllocation.mjs";
import SunatVoucher from "../models/SunatVoucher.js";
import MassUploadBatch from "../models/MassUploadBatch.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import { recordAudit, workflowEvent } from "./auditService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { activeApprovalStep, initializeApprovalRoute } from "./approvalRuleService.js";
import {
  assertConfiguredDocuments,
  configuredDocumentRequirements,
  configuredQuotationPolicy,
  documentStatusByPhase,
  SUBMISSION_DOCUMENT_KINDS,
  validateStructuredQuotationComparison
} from "./documentRuleService.js";
import { applyExchangeRate, resolveExchangeRateSnapshot } from "./exchangeRateService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { notificationText, notifyRoles, notifyApprovalStep, notifyUser, resolveApprovalNotifications, resolveNotification, resolveRequestNotifications } from "./notificationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { assertRequestLines } from "./requestRules.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { assertSupplierSubmittable } from "./supplierService.js";
import { assertSupplierSelectable, isDepartmentScoped } from "./supplierVisibilityService.js";
import { limaToday } from "../../../shared/businessCalendar.mjs";
import { transitionRequest, canTransition } from "./workflowService.js";
import { assertInvoiceEvidencePair, INVOICE_EVIDENCE_KINDS, latestInvoiceEvidence, parseInvoiceEvidence, validateInvoiceAgainstRequest } from "./xmlValidationService.js";
import { previewBudget, releaseBudget } from "./budgetService.js";
import { evaluateProcurementReadiness } from "./procurementReadinessService.js";
import { cancelProcurementOnVoid, settleProcurementAtClosure } from "./purchaseOrderService.js";
import { AppError } from "../utils/AppError.js";
import {
  DEFAULT_CAPEX_DETAILS_THRESHOLD,
  DOCUMENT_PHASE,
  ERROR_CODES,
  FINANCE_CONFIGURATION_KEYS,
  FLOW_TYPE,
  PAYABLE_ACCOUNT_TYPES,
  REQUEST_FREQUENCIES,
  REQUEST_PRIORITIES,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { actsAsRequester, canModifyRequest, canUseCostCenter, canViewRequest, canWithdrawRequest, observationOwner, requestVisibilityFilter, wasSubmitted } from "../utils/permissions.js";
import { multiplyMoney } from "../utils/money.js";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import { allowedRequestActions } from "./requestActionPolicy.js";
import { plainClone } from "../utils/plainClone.js";
import { supplierCreditDays } from "../../../shared/invoiceFinance.mjs";

export const requestPopulate = [
  { path: "supplier" },
  { path: "requester", select: "name email role area costCenter authorizedCostCenters" },
  { path: "solicitor", select: "name email role area costCenter authorizedCostCenters" },
  { path: "requesterCostCenter" },
  { path: "costCenterReviewers", select: "name jobTitle area" },
  { path: "lines.costCenter" },
  { path: "lines.expenseType" },
  { path: "quotations.supplier", select: "supplierCode name commercialName legalName rucDni normalizedIdentifier homologationStatus active taxpayerStatus taxpayerValidation" },
  { path: "approvalHistory.actor", select: "name email role approvalLevel" },
  { path: "approvalRouteSnapshot.completedBy", select: "name email role approvalLevel" },
  { path: "budgetCommitment" },
  { path: "accountsPayable" },
  { path: "purchaseOrder" },
  { path: "paymentBatch" },
  { path: "reconciliation" },
  { path: "fiscalData.processedBy", select: "name email role" },
  { path: "payment.confirmedBy", select: "name email role" },
  { path: "rendition.submittedBy", select: "name email role" },
  { path: "rendition.validator", select: "name email role" }
];

export const requestListSelect = [
  "requestNumber", "issueDate", "accountingPeriod", "requester", "solicitor", "requesterArea", "requestingArea",
  "schoolOrDepartment", "flowType", "requestType", "expenseNature", "priority", "priorityRank", "frequency", "project", "areaCorrelative", "title", "currency", "exchangeRate",
  "paymentAccount", "invoiceDetails", "costCenterType", "costAllocations",
  "totalNet", "totalIGV", "totalAmount", "totalPENEquivalent", "supplier", "supplierSnapshot", "status",
  "description", "payment", "rendition", "approvalStage", "approvalDueAt", "approvalRouteSnapshot", "purchaseOrder", "createdAt", "updatedAt"
].join(" ");

export const requestListPopulate = [
  { path: "supplier", select: "supplierCode name commercialName legalName rucDni normalizedIdentifier homologationStatus active" },
  { path: "requester", select: "name email role area" },
  { path: "solicitor", select: "name email role area" }
];

const attachmentKinds = Object.freeze({
  xml: "XML",
  pdf: "PDF",
  feeReceipt: "FEE_RECEIPT",
  quotation: "QUOTATION",
  purchaseOrder: "PURCHASE_ORDER",
  contract: "CONTRACT",
  conformity: "CONFORMITY",
  activityReport: "ACTIVITY_REPORT",
  supporting: "SUPPORTING",
  rendition: "RENDITION",
  returnReceipt: "RETURN_RECEIPT",
  cciLetter: "CCI_LETTER"
});

export function parseSupplierPaymentTerms(value) {
  const terms = parseJson(value, "supplierPaymentTerms");
  if (!terms) return undefined;
  if (typeof terms !== "object" || Array.isArray(terms)) throw new AppError(422, "Invalid supplier payment terms.");
  const errors = validatePaymentTerms(terms, { requireComplete: false });
  if (errors.length) throw new AppError(422, "Review the supplier payment terms.", { errors }, ERROR_CODES.VALIDATION_ERROR);
  return normalizePaymentTerms(terms);
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

const A1_B_EXPENDITURE_CLASSIFICATIONS = new Set([REQUEST_TYPE.OPEX, REQUEST_TYPE.CAPEX]);
const TRACK_C_REQUEST_TYPES = new Set([REQUEST_TYPE.ENTREGA_RENDIR, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO]);

export function normalizeRequestTypeForTrack(flowType, requestType) {
  const normalizedFlow = flowType || FLOW_TYPE.A1;

  // Track C carries two request types: an advance to render (the default) and an
  // undocumented reimbursement of money the employee already spent.
  if (normalizedFlow === FLOW_TYPE.C) return TRACK_C_REQUEST_TYPES.has(requestType) ? requestType : REQUEST_TYPE.ENTREGA_RENDIR;

  if ([FLOW_TYPE.A1, FLOW_TYPE.B].includes(normalizedFlow) && !A1_B_EXPENDITURE_CLASSIFICATIONS.has(requestType)) {
    throw new AppError(
      422,
      "Tracks A1 and B only allow CAPEX or OPEX as the expenditure classification.",
      {
        flowType: normalizedFlow,
        requestType,
        allowedRequestTypes: [REQUEST_TYPE.CAPEX, REQUEST_TYPE.OPEX]
      },
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  return requestType;
}

function maskBankValue(value) {
  const text = String(value || "");
  if (!text) return "";
  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function serializePaymentRecords(records, user) {
  const reveal = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user?.role);
  return records.map((record) => {
    const value = record.toObject ? record.toObject() : { ...record };
    if (reveal || !value.bankAccountSnapshot) return value;
    return {
      ...value,
      bankAccountSnapshot: {
        ...value.bankAccountSnapshot,
        accountHolderName: undefined,
        accountNumber: maskBankValue(value.bankAccountSnapshot.accountNumber),
        cci: maskBankValue(value.bankAccountSnapshot.cci)
      }
    };
  });
}

function serializePaymentBatches(records, user) {
  const reveal = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY].includes(user?.role);
  return records.map((record) => {
    const value = record.toObject ? record.toObject() : { ...record };
    if (reveal) return value;
    return {
      ...value,
      items: (value.items || []).map((item) => ({
        ...item,
        bankAccount: item.bankAccount ? {
          ...item.bankAccount,
          accountHolderName: undefined,
          accountNumber: maskBankValue(item.bankAccount.accountNumber),
          cci: maskBankValue(item.bankAccount.cci)
        } : item.bankAccount
      }))
    };
  });
}

function parseJson(value, field) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value || "null");
  } catch {
    throw new AppError(400, `${field} must contain valid JSON.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  }
}

export function parseRequestLines(value) {
  const parsed = parseJson(value, "lines") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "lines must be an array.", { field: "lines" }, ERROR_CODES.VALIDATION_ERROR);
  return parsed.map((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) throw new AppError(422, "Each request line must be an object.", { line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    let calculated = {};
    if (line.priceIncludesIGV !== undefined) {
      try {
        calculated = calculateRequestLineAmounts(line);
      } catch (error) {
        throw new AppError(422, error.message, { line: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
      }
    }
    return {
      itemDescription: line.itemDescription || "",
      quantity: line.quantity === "" || line.quantity === undefined || line.quantity === null ? undefined : Number(line.quantity),
      unitOfMeasure: line.unitOfMeasure || "",
      unitPrice: line.unitPrice === "" || line.unitPrice === undefined || line.unitPrice === null ? undefined : Number(line.unitPrice),
      priceIncludesIGV: line.priceIncludesIGV,
      costCenter: line.costCenter?._id || line.costCenter,
      budgetItem: line.budgetItem || line.budgetItemId || "",
      projectId: line.projectId || "",
      subAccount: line.subAccount || "",
      netAmount: Number(line.netAmount ?? line.net ?? 0),
      igvAmount: Number(line.igvAmount ?? line.igv ?? 0),
      totalAmount: Number(line.totalAmount ?? line.total ?? 0),
      ...calculated
    };
  });
}

export function parseQuotations(value) {
  const parsed = parseJson(value, "quotations") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "quotations must be an array.", { field: "quotations" }, ERROR_CODES.VALIDATION_ERROR);
  return parsed.map((quotation, index) => {
    if (!quotation || typeof quotation !== "object" || Array.isArray(quotation)) throw new AppError(400, "Each quotation must be an object.", { quotation: index + 1 }, ERROR_CODES.VALIDATION_ERROR);
    const errors = validatePaymentTerms(quotation, { requireComplete: false });
    if (errors.length) throw new AppError(422, "Review the quotation payment terms.", { quotation: index + 1, errors }, ERROR_CODES.VALIDATION_ERROR);
    return {
      supplier: quotation.supplier?._id || quotation.supplier,
      amount: quotation.amount === "" || quotation.amount === undefined || quotation.amount === null ? undefined : Number(quotation.amount),
      currency: quotation.currency,
      deliveryPeriod: quotation.deliveryPeriod || "",
      ...normalizePaymentTerms(quotation),
      commercialConditions: quotation.commercialConditions || "",
      attachment: quotation.attachment?._id || quotation.attachment,
      recommended: parseBoolean(quotation.recommended)
    };
  });
}

function optionalNumber(value) {
  return value === "" || value === undefined || value === null ? undefined : Number(value);
}

function parseCapexDetails(value) {
  const parsed = parseJson(value, "capexDetails") || {};
  return {
    projectPep: parsed.projectPep || "",
    projectSnapshot: { id: parsed.projectSnapshot?.id?._id || parsed.projectSnapshot?.id || parsed.projectId || undefined },
    assetCategory: parsed.assetCategory || undefined,
    usefulLifeYears: optionalNumber(parsed.usefulLifeYears),
    npv: {
      amount: optionalNumber(parsed.npv?.amount),
      currency: parsed.npv?.currency || undefined
    },
    payback: {
      value: optionalNumber(parsed.payback?.value),
      unit: parsed.payback?.unit || undefined
    }
  };
}

function parseOpexDetails(value) {
  const parsed = parseJson(value, "opexDetails") || {};
  return { expenseFrequency: parsed.expenseFrequency || undefined };
}

function parsePriority(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const priority = String(value).trim().toUpperCase();
  if (!REQUEST_PRIORITIES.includes(priority)) throw new AppError(422, "Choose the priority: high, medium or low.", { field: "priority", value }, ERROR_CODES.VALIDATION_ERROR);
  return priority;
}

function parseFrequency(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const frequency = String(value).trim().toUpperCase();
  if (!REQUEST_FREQUENCIES.includes(frequency)) throw new AppError(422, "Choose how often it is needed: once, monthly, every 3 months or yearly.", { field: "frequency", value }, ERROR_CODES.VALIDATION_ERROR);
  return frequency;
}

export function parseCostCenterType(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const type = String(value).trim().toUpperCase();
  if (!COST_CENTER_TYPES.includes(type)) throw new AppError(422, "Choose the cost center type: Propio or Por Encargo.", { field: "costCenterType", value }, ERROR_CODES.INVALID_COST_ALLOCATION);
  return type;
}

// The beneficiary CECOs of a Por Encargo request, as { costCenter, percentage }. Only ids of the
// CECO master are taken (never a typed code); one beneficiary alone is 100%.
export function parseCostAllocations(value) {
  const parsed = parseJson(value, "costAllocations") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "costAllocations must be an array.", { field: "costAllocations" }, ERROR_CODES.VALIDATION_ERROR);
  return parsed.map((allocation, index) => {
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) throw new AppError(422, "Each cost center of the distribution must be an object.", { field: `costAllocations.${index}` }, ERROR_CODES.INVALID_COST_ALLOCATION);
    const costCenter = String(allocation.costCenter?._id || allocation.costCenter || "");
    if (costCenter && !/^[a-f\d]{24}$/i.test(costCenter)) throw new AppError(422, "Choose an active school or department from the cost center list.", { field: `costAllocations.${index}.costCenter` }, ERROR_CODES.INVALID_COST_ALLOCATION);
    const percentage = optionalNumber(allocation.percentage);
    return { costCenter: costCenter || undefined, percentage: percentage === undefined && parsed.length === 1 ? 100 : percentage };
  });
}

function optionalMoney(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new AppError(422, "Enter a valid amount.", { field }, ERROR_CODES.VALIDATION_ERROR);
  return Math.round(number * 100) / 100;
}

// The comprobante as read from its file or typed by the requester (it is checked again when
// Accounting registers the invoice). status PENDING: it was not issued when the request was made.
export function parseInvoiceDetails(value) {
  const parsed = parseJson(value, "invoiceDetails");
  if (!parsed || typeof parsed !== "object") return undefined;
  const status = parsed.status === "PENDING" ? "PENDING" : "ATTACHED";
  if (status === "PENDING") return { status };
  const issueDate = String(parsed.issueDate || "").slice(0, 10);
  if (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new AppError(422, "Enter the issue date of the receipt as dd/mm/yyyy.", { field: "invoiceDetails.issueDate" }, ERROR_CODES.VALIDATION_ERROR);
  // A receipt cannot be issued after today in Lima.
  if (issueDate && issueDate > limaToday()) throw new AppError(422, "The receipt's issue date cannot be later than today.", { field: "invoiceDetails.issueDate", issueDate }, ERROR_CODES.VALIDATION_ERROR);
  const ruc = String(parsed.ruc || "").replace(/\D/g, "");
  if (ruc && !/^(\d{8}|\d{11})$/.test(ruc)) throw new AppError(422, "The receipt's RUC must have 11 digits.", { field: "invoiceDetails.ruc" }, ERROR_CODES.VALIDATION_ERROR);
  const currency = parsed.currency ? String(parsed.currency).toUpperCase() : undefined;
  if (currency && !["PEN", "USD"].includes(currency)) throw new AppError(422, "The receipt's currency must be PEN or USD.", { field: "invoiceDetails.currency" }, ERROR_CODES.VALIDATION_ERROR);
  return {
    status,
    source: ["XML", "PDF", "MANUAL"].includes(parsed.source) ? parsed.source : "MANUAL",
    documentType: String(parsed.documentType || "").trim().slice(0, 40) || undefined,
    number: String(parsed.number || "").trim().slice(0, 40) || undefined,
    issueDate: issueDate ? new Date(`${issueDate}T00:00:00.000Z`) : undefined,
    ruc: ruc || undefined,
    supplierName: String(parsed.supplierName || "").trim().slice(0, 200) || undefined,
    currency,
    totalAmount: optionalMoney(parsed.totalAmount, "invoiceDetails.totalAmount"),
    igvAmount: optionalMoney(parsed.igvAmount, "invoiceDetails.igvAmount")
  };
}

// The supplier account the requester chose: one of this supplier's active current or savings
// accounts. Only its bank, type, currency and last four digits are copied to the request.
async function applyPaymentAccount(request, supplier) {
  const chosen = request.$locals.paymentAccountId;
  const accountId = chosen === undefined ? request.paymentAccount?.account?._id || request.paymentAccount?.account : chosen;
  if (!supplier || !accountId) {
    request.paymentAccount = undefined;
    return;
  }
  const account = await SupplierBankAccount.findOne({ _id: accountId, supplier: supplier._id, active: true, accountType: { $in: PAYABLE_ACCOUNT_TYPES } }).lean();
  if (!account) {
    // A supplier changed on the request takes none of the previous supplier's accounts with it.
    if (chosen === undefined) {
      request.paymentAccount = undefined;
      return;
    }
    throw new AppError(422, "Choose one of the supplier's active bank accounts.", { field: "paymentAccount", paymentAccount: accountId }, ERROR_CODES.BANK_ACCOUNT_NOT_ELIGIBLE);
  }
  request.paymentAccount = {
    account: account._id,
    bank: account.bank,
    bankOtherName: account.bankOtherName || undefined,
    currency: account.currency,
    accountType: account.accountType,
    accountLast4: String(account.accountNumber || account.cci || "").slice(-4)
  };
}

function mapAttachments(files, userId) {
  return Object.entries(attachmentKinds).flatMap(([field, kind]) =>
    (files[field] || []).map((file) => ({
      kind,
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: file.url,
      mimetype: file.mimetype,
      size: file.size,
      checksum: file.checksum,
      uploadedBy: userId
    }))
  );
}

function supplierSnapshot(supplier) {
  return {
    identifierType: supplier.identifierType,
    identifier: supplier.normalizedIdentifier || supplier.rucDni,
    legalName: supplier.legalName || supplier.name,
    homologationStatus: supplier.homologationStatus || supplier.status
  };
}

async function applyQuotationSnapshots(request) {
  const supplierIds = (request.quotations || []).map((quotation) => quotation.supplier?._id || quotation.supplier).filter(Boolean);
  if (!supplierIds.length) return;
  const suppliers = await Supplier.find({ _id: { $in: supplierIds } }).select("identifierType normalizedIdentifier rucDni legalName name");
  const byId = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
  for (const quotation of request.quotations || []) {
    const supplier = byId.get(String(quotation.supplier?._id || quotation.supplier || ""));
    if (!quotation.supplier) continue;
    if (!supplier) {
      throw new AppError(404, "A quotation supplier was not found.", { supplier: quotation.supplier }, ERROR_CODES.NOT_FOUND);
    }
    quotation.supplierSnapshot = {
      identifierType: supplier.identifierType,
      identifier: supplier.normalizedIdentifier || supplier.rucDni,
      legalName: supplier.legalName || supplier.name
    };
  }
}

function linkQuotationEvidence(request) {
  const evidence = (request.attachments || []).filter((attachment) => attachment.kind === "QUOTATION");
  const byId = new Map(evidence.map((attachment) => [String(attachment._id), attachment]));
  const used = new Set();
  for (const quotation of request.quotations || []) {
    const id = String(quotation.attachment?._id || quotation.attachment || "");
    if (id && byId.has(id) && !used.has(id)) {
      quotation.attachment = byId.get(id)._id;
      used.add(id);
    } else {
      quotation.attachment = undefined;
    }
  }
  const available = evidence.filter((attachment) => !used.has(String(attachment._id)));
  for (const quotation of request.quotations || []) {
    if (quotation.attachment || !available.length) continue;
    const attachment = available.shift();
    quotation.attachment = attachment._id;
  }
}

async function applyProjectSnapshot(request) {
  if (request.requestType !== REQUEST_TYPE.CAPEX) {
    request.capexDetails = {};
    return;
  }
  request.opexDetails = {};
  const projectId = request.capexDetails?.projectSnapshot?.id?._id || request.capexDetails?.projectSnapshot?.id;
  if (!projectId) return;
  const project = await Project.findOne({ _id: projectId, active: true });
  if (!project) throw new AppError(422, "Select an active Project / PEP.", { project: projectId }, ERROR_CODES.VALIDATION_ERROR);
  request.capexDetails.projectSnapshot = { id: project._id, code: project.code, name: project.name };
  request.capexDetails.projectPep ||= project.code;
  request.project = project.code;
}

async function validateHeaderCostCenter(request, user, { required = false } = {}) {
  const id = request.requesterCostCenter?._id || request.requesterCostCenter;
  if (!id) {
    if (!required) return null;
    throw new AppError(422, "A request Cost Center / CECO is required.", { field: "requesterCostCenter" }, ERROR_CODES.INVALID_COST_CENTER);
  }
  const center = await CostCenter.findById(id);
  if (!center?.active) {
    throw new AppError(422, "Select an active Cost Center / CECO.", { costCenter: id }, ERROR_CODES.INVALID_COST_CENTER);
  }
  if (actsAsRequester(user) && user.role !== ROLES.ADMIN && !canUseCostCenter(user, center._id)) {
    throw new AppError(
      403,
      `CECO ${center.code} - ${center.name} is not assigned to the current requester.`,
      { costCenter: center._id, code: center.code, name: center.name, area: center.area },
      ERROR_CODES.INVALID_COST_CENTER
    );
  }
  request.requesterCostCenter = center._id;
  request.requesterCostCenterSnapshot = costCenterSnapshot(center);
  return center;
}

// The title is the first line of the description when the requester left it empty (the simple
// form asks only "what do you need?"). The risk if not approved is optional: one "why" is enough.
export function titleFromDescription(description) {
  const line = String(description || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}...` : line;
}

function assertOfficialRequestFields(request) {
  if (!String(request.title || "").trim()) request.title = titleFromDescription(request.detailedDescription || request.description);
  const required = [
    ["title", "TITLE_REQUIRED", "Requirement title is required."],
    ["detailedDescription", "DETAILED_DESCRIPTION_REQUIRED", "Detailed description is required."],
    ["businessJustification", "BUSINESS_JUSTIFICATION_REQUIRED", "Business justification is required."]
  ];
  for (const [field, code, message] of required) {
    if (!String(request[field] || "").trim()) throw new AppError(422, message, { field }, ERROR_CODES[code]);
  }
}

function isOfficialCapexOpexRequest(request) {
  if (request.flowType !== FLOW_TYPE.A1 || ![REQUEST_TYPE.CAPEX, REQUEST_TYPE.OPEX].includes(request.requestType)) return false;
  return Boolean(
    String(request.areaCorrelative || request.title || request.detailedDescription || request.businessJustification || request.nonApprovalRisk || "").trim()
    || request.quotations?.length
    || (request.lines || []).some((line) => line.itemDescription || (line.quantity !== undefined && line.quantity !== null) || (line.unitPrice !== undefined && line.unitPrice !== null) || line.unitOfMeasure)
    || request.capexDetails?.assetCategory
    || request.capexDetails?.projectSnapshot?.id
    || request.opexDetails?.expenseFrequency
  );
}

function officialAuditSnapshot(request) {
  const recommended = (request.quotations || []).find((quotation) => quotation.recommended);
  return {
    requestType: request.requestType,
    requesterCostCenter: request.requesterCostCenter?._id || request.requesterCostCenter,
    costCenterType: request.costCenterType || COST_CENTER_TYPE.OWN,
    ...(request.costAllocations?.length ? { costAllocations: request.costAllocations.map((allocation) => ({
      costCenter: allocation.costCenter?._id || allocation.costCenter,
      code: allocation.costCenterSnapshot?.code,
      percentage: allocation.percentage,
      amount: allocation.amount
    })) } : {}),
    areaCorrelative: request.areaCorrelative,
    title: request.title,
    detailedDescription: request.detailedDescription,
    businessJustification: request.businessJustification,
    nonApprovalRisk: request.nonApprovalRisk,
    capexDetails: request.capexDetails,
    opexDetails: request.opexDetails,
    quotationCount: request.quotations?.length || 0,
    recommendedSupplier: recommended?.supplier?._id || recommended?.supplier,
    supplierSelectionReason: request.supplierSelectionReason,
    ...(request.supplierPaymentTerms ? { supplierPaymentTerms: request.supplierPaymentTerms.toObject() } : {}),
    ...(request.supplierCreditDaysSnapshot != null ? { supplierCreditDaysSnapshot: request.supplierCreditDaysSnapshot } : {})
  };
}

async function assertQuotationPolicy(request) {
  const policy = await configuredQuotationPolicy(request);
  const result = validateStructuredQuotationComparison(request, policy);
  if (!result.valid) {
    const primary = result.errors[0]?.code || ERROR_CODES.VALIDATION_ERROR;
    throw new AppError(
      422,
      "The quotation comparison is incomplete or inconsistent.",
      { errors: result.errors, policy },
      ERROR_CODES[primary] || primary
    );
  }
  return result;
}

function applyEditableFields(request, payload) {
  const fields = [
    "flowType",
    "requestType",
    "expenseNature",
    "priority",
    "schoolOrDepartment",
    "project",
    "areaCorrelative",
    "title",
    "detailedDescription",
    "businessJustification",
    "nonApprovalRisk",
    "observations",
    "supplierSelectionReason",
    "issueDate",
    "accountingPeriod",
    "currency",
    "supplier",
    "description"
  ];
  for (const field of fields) if (payload[field] !== undefined) request[field] = payload[field];
  if (payload.priority !== undefined) request.priority = parsePriority(payload.priority) || "MEDIA";
  if (payload.frequency !== undefined) request.frequency = parseFrequency(payload.frequency) || "ONE_OFF";
  if (payload.paymentAccount !== undefined) request.$locals.paymentAccountId = payload.paymentAccount || null;
  if (payload.invoiceDetails !== undefined) request.invoiceDetails = parseInvoiceDetails(payload.invoiceDetails);
  if (payload.supplierPaymentTerms !== undefined) request.supplierPaymentTerms = parseSupplierPaymentTerms(payload.supplierPaymentTerms);
  if (payload.requesterCostCenter !== undefined) request.requesterCostCenter = payload.requesterCostCenter?._id || payload.requesterCostCenter;
  if (payload.costCenterType !== undefined) request.costCenterType = parseCostCenterType(payload.costCenterType) || COST_CENTER_TYPE.OWN;
  if (payload.costAllocations !== undefined) request.costAllocations = parseCostAllocations(payload.costAllocations);
  if (payload.capexDetails !== undefined) request.capexDetails = parseCapexDetails(payload.capexDetails);
  if (payload.opexDetails !== undefined) request.opexDetails = parseOpexDetails(payload.opexDetails);
  if (payload.quotations !== undefined) request.quotations = parseQuotations(payload.quotations);
}

// The requester takes back a wrong upload while the request is still theirs to edit. Only the
// documents-step files qualify: quotation evidence is replaced from its own quotation, and later
// phases' evidence (invoice registration, rendition) is not withdrawn from the request form.
// Ids no longer on the request (removed in another tab) are ignored.
function removeRequestAttachments(request, value) {
  const parsed = parseJson(value, "removeAttachments") || [];
  if (!Array.isArray(parsed)) throw new AppError(400, "removeAttachments must be an array.", { field: "removeAttachments" }, ERROR_CODES.VALIDATION_ERROR);
  const ids = new Set(parsed.map(String));
  const removed = (request.attachments || []).filter((attachment) => ids.has(String(attachment._id)));
  const locked = removed.filter((attachment) => !SUBMISSION_DOCUMENT_KINDS.includes(attachment.kind));
  if (locked.length) throw new AppError(422, "Only the request's own documents can be removed here.", { attachments: locked.map((attachment) => ({ id: attachment._id, kind: attachment.kind })) }, ERROR_CODES.VALIDATION_ERROR);
  if (!removed.length) return [];
  request.attachments = request.attachments.filter((attachment) => !ids.has(String(attachment._id)));
  // A verification read from a removed invoice file no longer stands; any remaining file is read again.
  if (removed.some((attachment) => INVOICE_EVIDENCE_KINDS.includes(attachment.kind))) request.xmlValidation = undefined;
  return removed;
}

function normalizeTrackFields(request) {
  request.flowType ||= FLOW_TYPE.A1;
  request.requestType = normalizeRequestTypeForTrack(request.flowType, request.requestType);

  if (request.flowType === FLOW_TYPE.C) {
    request.supplier = undefined;
    request.supplierSnapshot = undefined;
    request.quotations = [];
    request.supplierSelectionReason = "";
    request.directPayment = undefined;
    request.fiscalData = undefined;
    request.capexDetails = {};
    request.opexDetails = {};
    request.paymentAccount = undefined;
    request.invoiceDetails = undefined;
    request.supplierPaymentTerms = undefined;
    request.supplierCreditDaysSnapshot = undefined;
  }

  // A1 and B carry the supplier's quotations; the other tracks have none.
  if (![FLOW_TYPE.A1, FLOW_TYPE.B].includes(request.flowType)) {
    request.quotations = [];
    request.supplierSelectionReason = "";
  }
}

// An A1 sent with its factura PDF (no XML, which is checked in full) is checked for its issuer: an
// invoice from another RUC could not be registered against the order once it is approved. A PDF
// that cannot be read is checked when the invoice is registered.
async function assertInvoiceIssuedBySupplier(request, supplier) {
  if (!supplier || (request.attachments || []).some((attachment) => attachment.kind === "XML")) return;
  const pdf = [...(request.attachments || [])].reverse().find((attachment) => attachment.kind === "PDF" && attachment.path);
  if (!pdf) return;
  const expectedRuc = String(supplier.normalizedIdentifier || supplier.rucDni || "").replace(/\D/g, "");
  const buyerRuc = String(process.env.SIRE_TAXPAYER_RUC || "").replace(/\D/g, "") || undefined;
  let invoiceRuc;
  try { invoiceRuc = (await parseInvoiceEvidence(pdf.path, { expectedRuc, buyerRuc })).data?.ruc; } catch { return; }
  if (invoiceRuc && expectedRuc && invoiceRuc !== expectedRuc) {
    throw new AppError(422, "The attached invoice was issued by another RUC than the selected supplier. Select the supplier that issued it, or attach this supplier's invoice.", { field: "supplier", invoiceRuc, supplierRuc: expectedRuc }, ERROR_CODES.SUPPLIER_INVOICE_MISMATCH);
  }
}

// The requester picks suppliers from their area's list (supplierVisibilityService). A supplier the
// request already carried stays, so a draft is never locked by a later change of areas.
async function assertSuppliersOnRequesterList(request, supplier, user) {
  if (!isDepartmentScoped(user)) return;
  const previous = new Set((request.$locals.previousSupplierIds || []).map(String));
  if (supplier) assertSupplierSelectable(supplier, user, { alreadyOnRequest: previous.has(String(supplier._id)) });
  const quoted = [...new Set((request.quotations || []).map((quotation) => String(quotation.supplier?._id || quotation.supplier || "")).filter(Boolean))]
    .filter((id) => id !== String(supplier?._id || "") && !previous.has(id));
  if (!quoted.length) return;
  for (const other of await Supplier.find({ _id: { $in: quoted } }).select("departments proposedBy supplierCode")) assertSupplierSelectable(other, user);
}

const costCenterSnapshot = (center) => ({
  code: center.code,
  name: center.name,
  area: center.area,
  organizationalUnit: center.organizationalUnit,
  organizationalUnitCode: center.organizationalUnitCode
});

// Tipo de Centro de Costo. Propio keeps the requester's own (or authorized) CECO on the lines, as
// before. Por Encargo charges the school or department the request is for: its CECOs come only
// from the active CECO master, the distribution adds up to 100%, and every line carries the first
// beneficiary's CECO (budget and journals share the expense when there are several). Advances and
// reimbursements (Track C) are rendered against the advance's own CECO, so they stay Propio.
async function applyCostCenterType(request, user) {
  if (request.costCenterType !== COST_CENTER_TYPE.ON_BEHALF) {
    request.costCenterType = COST_CENTER_TYPE.OWN;
    request.costAllocations = undefined;
    request.costCenterReviewers = undefined;
    return;
  }
  if (request.flowType === FLOW_TYPE.C) {
    throw new AppError(422, "Advances and reimbursements are charged to your own cost center: choose Propio.", { field: "costCenterType", flowType: request.flowType }, ERROR_CODES.INVALID_COST_ALLOCATION);
  }
  const allocations = request.costAllocations || [];
  const problems = costAllocationProblems(allocations);
  if (problems.length) throw new AppError(422, problems[0].message, { field: problems[0].field, problems }, ERROR_CODES.INVALID_COST_ALLOCATION);
  const centers = await CostCenter.find({ _id: { $in: allocations.map((allocation) => allocation.costCenter) }, active: true });
  const byId = new Map(centers.map((center) => [String(center._id), center]));
  for (const [index, allocation] of allocations.entries()) {
    const center = byId.get(String(allocation.costCenter?._id || allocation.costCenter));
    if (!center) throw new AppError(422, "Choose an active school or department from the cost center list.", { field: `costAllocations.${index}.costCenter`, costCenter: allocation.costCenter }, ERROR_CODES.INVALID_COST_ALLOCATION);
    allocation.costCenterSnapshot = costCenterSnapshot(center);
  }
  const own = String(request.requesterCostCenter?._id || request.requesterCostCenter || user?.costCenter?._id || user?.costCenter || "");
  if (allocations.length === 1 && own && String(allocations[0].costCenter?._id || allocations[0].costCenter) === own) {
    throw new AppError(422, "That is your own cost center: choose Propio, or the school or department the request is for.", { field: "costAllocations.0.costCenter" }, ERROR_CODES.INVALID_COST_ALLOCATION);
  }
  for (const line of request.lines || []) line.costCenter = allocations[0].costCenter;
}

async function prepareRequest(request, { user, files = {}, validateSubmission = false }) {
  normalizeTrackFields(request);
  await applyCostCenterType(request, user);
  const officialRequest = isOfficialCapexOpexRequest(request);
  assertRequestLines(request.lines);
  // A requester may charge only their own or authorized CECOs. Por Encargo lines carry the
  // beneficiary's CECO, already checked against the active CECO master above.
  await validateAccountingDimensions({
    requestType: request.requestType,
    expenseNature: request.expenseNature,
    lines: request.lines,
    user: request.costCenterType === COST_CENTER_TYPE.ON_BEHALF ? undefined : user
  });
  const supplier = request.flowType === FLOW_TYPE.C ? null : await Supplier.findById(request.supplier?._id || request.supplier);
  if (request.flowType !== FLOW_TYPE.C && !supplier) throw new AppError(404, "Supplier not found.", { supplier: request.supplier }, ERROR_CODES.NOT_FOUND);
  await assertSuppliersOnRequesterList(request, supplier, user);
  if (supplier) request.supplierSnapshot = supplierSnapshot(supplier);
  if (supplier && (request.isNew || request.isModified("supplier") || request.supplierCreditDaysSnapshot == null)) {
    request.supplierCreditDaysSnapshot = supplierCreditDays(supplier.paymentTerms) ?? undefined;
  }
  if (validateSubmission && request.supplierPaymentTerms?.paymentCondition) {
    const errors = validatePaymentTerms(request.supplierPaymentTerms);
    if (errors.length) throw new AppError(422, "Review the supplier payment terms.", { errors }, ERROR_CODES.VALIDATION_ERROR);
  }
  await applyPaymentAccount(request, supplier);
  linkQuotationEvidence(request);
  await applyQuotationSnapshots(request);
  request.requesterCostCenter ||= user.costCenter;
  await validateHeaderCostCenter(request, user, { required: validateSubmission });
  await applyProjectSnapshot(request);
  await applyExchangeRate(request);
  // Only checked here: the request number is taken when the request is actually saved.
  request.$locals.deferRequestNumber = true;
  try {
    await request.validate({ pathsToSkip: ["requestNumber"] });
  } finally {
    delete request.$locals.deferRequestNumber;
  }

  // Track B carries its invoice: the XML when there is one, otherwise the factura PDF. Other tracks
  // check an XML attached early, as before; their invoice is registered later.
  const xmlAttachment = request.flowType === FLOW_TYPE.B ? latestInvoiceEvidence(request.attachments) : latestInvoiceEvidence((request.attachments || []).filter((attachment) => attachment.kind === "XML"));
  if (xmlAttachment) {
    const pdfAttachment = [...(request.attachments || [])].reverse().find((item) => item.kind === "PDF");
    if (xmlAttachment.kind === "XML") await assertInvoiceEvidencePair(xmlAttachment.path, pdfAttachment?.path);
    request.xmlValidation = await validateInvoiceAgainstRequest(xmlAttachment.path, {
      supplier,
      fiscalData: request.fiscalData,
      currency: request.currency,
      totalNet: request.totalNet,
      totalIGV: request.totalIGV,
      totalAmount: request.totalAmount
    }, {
      request,
      requestNumber: request.requestNumber,
      supplier,
      user,
      fileName: xmlAttachment.originalName
    });
    request.xmlValidationHistory.push(request.xmlValidation);
    // The comprobante's own data, as read from its file, unless the requester typed it.
    const read = request.xmlValidation.data || {};
    if (read.invoiceNumber && request.invoiceDetails?.source !== "MANUAL") {
      request.invoiceDetails = {
        status: "ATTACHED",
        source: request.xmlValidation.source || "XML",
        documentType: read.voucherType || read.documentTypeCode || undefined,
        number: read.invoiceNumber,
        issueDate: read.issueDate ? new Date(`${String(read.issueDate).slice(0, 10)}T00:00:00.000Z`) : undefined,
        ruc: read.ruc || undefined,
        supplierName: read.supplierName || undefined,
        currency: read.currency || undefined,
        totalAmount: read.totalAmount ?? undefined,
        igvAmount: read.igvAmount ?? undefined
      };
    }
    if (request.flowType === FLOW_TYPE.B && request.xmlValidation.validated) {
      const data = request.xmlValidation.data || {};
      request.directPayment = {
        ...(request.directPayment?.toObject ? request.directPayment.toObject() : request.directPayment || {}),
        express: true,
        xmlLocked: true,
        immutableAmounts: {
          netAmount: Number(data.netAmount ?? request.totalNet),
          igvAmount: Number(data.igvAmount ?? request.totalIGV),
          totalAmount: Number(data.totalAmount ?? request.totalAmount),
          currency: data.currency || request.currency
        }
      };
    }
  }

  if (validateSubmission) {
    if (request.flowType === FLOW_TYPE.A2) {
      throw new AppError(422, "Track A2 is created from an approved Purchase Order through the batch-invoice workspace, not as a new request.", { flowType: request.flowType }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (request.flowType === FLOW_TYPE.C) {
      // Several advances may be open at once. Only a rendition that is past its deadline
      // and still not submitted blocks a new advance: PENDING (never sent) or OBSERVED
      // (returned to the employee, so not currently submitted). A rendition submitted on
      // time and waiting for Accounting (SUBMITTED) never blocks.
      if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
        const overdue = await FinancialRequest.findOne({
          _id: { $ne: request._id },
          requester: request.requester,
          flowType: FLOW_TYPE.C,
          requestType: REQUEST_TYPE.ENTREGA_RENDIR,
          "rendition.dueAt": { $lt: new Date() },
          "rendition.status": { $in: ["PENDING", "OBSERVED"] }
        }).select("requestNumber rendition.dueAt rendition.status");
        if (overdue) throw new AppError(409, "A new advance is blocked because the employee has an overdue rendition that has not been submitted.", { overdueRequest: overdue.requestNumber, dueAt: overdue.rendition?.dueAt, renditionStatus: overdue.rendition?.status }, ERROR_CODES.OVERDUE_RENDITION);
      }
    } else if (request.flowType === FLOW_TYPE.A1) {
      if (officialRequest) assertOfficialRequestFields(request);
      // A supplier still waiting for its proposer's jefe does not hold the request back: the jefe
      // verifies it while deciding the request, and no approval completes before it is approved.
      assertSupplierSubmittable(supplier);
      await assertInvoiceIssuedBySupplier(request, supplier);
    } else {
      assertSupplierSubmittable(supplier);
    }
    // A1 / B: "a quote or the invoice" first (the clearer message when neither is there), then
    // the quotations that were added, checked in full.
    await assertConfiguredDocuments(request, DOCUMENT_PHASE.SUBMISSION);
    if ([FLOW_TYPE.A1, FLOW_TYPE.B].includes(request.flowType)) await assertQuotationPolicy(request);
    // A B request may be sent with only its quote (the invoice is registered after approval); an
    // invoice that is attached must match the request.
    if (request.flowType === FLOW_TYPE.B && latestInvoiceEvidence(request.attachments) && !request.xmlValidation?.validated) {
      throw new AppError(422, "A verified invoice is required: upload its XML or its factura PDF.", { requestType: request.requestType }, ERROR_CODES.XML_VALIDATION_FAILED);
    }
  }
  return { supplier, files };
}

function routeAuditSnapshot(route = []) {
  return [...route].sort((a, b) => a.sequence - b.sequence).map((step) => ({
    sequence: step.sequence,
    approvalLevel: step.approvalLevel,
    role: step.role,
    approverUser: step.approverUser?._id || step.approverUser,
    approverName: step.approverSnapshot?.name,
    status: step.status,
    completedAt: step.completedAt,
    completedBy: step.completedBy?._id || step.completedBy,
    source: step.source
  }));
}

// The heads of the CECOs a Por Encargo request is charged to. Two existing ways of saying who leads
// an area: the Area Director or Vice-Rector of the CECO's area (their area or approval areas, as the
// approval inbox reads them; "*" and "General" are not an area), and the CECO's top jefe in the
// roster (someone whose own CECO it is, with active reports, whose own jefe is outside it). Active
// people only, never the requester.
export async function costCenterReviewersFor(request) {
  if (request.costCenterType !== COST_CENTER_TYPE.ON_BEHALF) return [];
  const allocations = request.costAllocations || [];
  const centers = allocations.map((allocation) => allocation.costCenter?._id || allocation.costCenter);
  const areas = [...new Set(allocations.map((allocation) => String(allocation.costCenterSnapshot?.area || "").trim()).filter((area) => area && area !== "*" && area.toUpperCase() !== "GENERAL"))];
  const requester = String(request.requester?._id || request.requester || request.solicitor?._id || request.solicitor || "");
  const internal = { active: true, role: { $nin: [ROLES.SUPER_ADMIN, ROLES.MANAGEMENT_VIEWER] } };
  const [directors, people] = await Promise.all([
    areas.length ? User.find({ ...internal, role: { $in: [ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR] }, $or: [{ area: { $in: areas } }, { approvalAreas: { $in: areas } }] }).select("_id").lean() : [],
    User.find({ ...internal, costCenter: { $in: centers } }).select("role costCenter jefe").lean()
  ]);
  const leading = new Set((await User.distinct("jefe", { jefe: { $in: people.map((person) => person._id) }, active: true })).map(String));
  const jefes = await User.find({ _id: { $in: people.map((person) => person.jefe).filter(Boolean) } }).select("costCenter").lean();
  const jefeCenter = new Map(jefes.map((jefe) => [String(jefe._id), String(jefe.costCenter || "")]));
  const heads = people.filter((person) => [ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR].includes(person.role)
    || (leading.has(String(person._id)) && jefeCenter.get(String(person.jefe || "")) !== String(person.costCenter)));
  const reviewers = new Map([...directors, ...heads].map((person) => [String(person._id), person._id]));
  reviewers.delete(requester);
  return [...reviewers.values()];
}

// The beneficiary's heads hear about the request at once; the approver of the first step already
// has its own notice.
async function notifyCostCenterReviewers(request) {
  const approver = String(activeApprovalStep(request)?.approverUser || "");
  const charged = (request.costAllocations || []).map((allocation) => `${allocation.costCenterSnapshot?.code || ""} ${allocation.costCenterSnapshot?.name || ""} (${allocation.percentage}%)`.trim()).join(", ");
  for (const reviewer of request.costCenterReviewers || []) {
    const userId = reviewer?._id || reviewer;
    if (String(userId) === approver) continue;
    await notifyUser({
      userId,
      eventKey: `request:${request._id}:on-behalf:${userId}`,
      type: "COST_CENTER_ON_BEHALF",
      title: notificationText("Request charged to your cost center"),
      message: notificationText("{requestNumber}: {area} requests {amount} on behalf of {costCenters}. Open it to review it or comment.", {
        requestNumber: request.requestNumber,
        area: request.requesterArea || request.requestingArea || "",
        amount: `${request.currency} ${Number(request.totalAmount || 0).toFixed(2)}`,
        costCenters: charged
      }),
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
  }
}

async function submitPreparedRequest(request, { user, req, comments }) {
  assertRequestActive(request);
  // A resubmission (after OBSERVE, RETURN or a withdrawal) never reuses the old
  // route: the route is re-resolved for the request's current amount, track and
  // area and restarts at the first approver. The replaced route is kept in the
  // audit log so its decisions stay visible.
  const previousRoute = routeAuditSnapshot(request.approvalRouteSnapshot || []);
  await initializeApprovalRoute(request);
  // Like the route, who reviews for the beneficiary is resolved again on every sending.
  const reviewers = await costCenterReviewersFor(request);
  request.costCenterReviewers = reviewers.length ? reviewers : undefined;
  request.rejectionReason = "";
  await request.save();
  if (previousRoute.length) {
    await recordAudit({
      entityType: "FinancialRequest",
      entity: request,
      action: "APPROVAL_ROUTE_RESET",
      user,
      req,
      module: "APPROVALS",
      comments: "Resubmitted: the approval route was re-resolved and restarts at the first approver.",
      oldValues: { approvalRoute: previousRoute },
      newValues: { approvalRoute: routeAuditSnapshot(request.approvalRouteSnapshot), approvalRoutingMode: request.approvalRoutingMode }
    });
  }

  await transitionRequest({
    request,
    targetStatus: REQUEST_STATUS.PENDING_APPROVAL,
    user,
    req,
    action: "APPROVAL_REQUESTED",
    comments: comments || "Submitted for approval.",
    nextApprovalStage: request.approvalStage,
    dueAt: request.approvalDueAt
  });
  await notifyApprovalStep(request);
  await notifyCostCenterReviewers(request);
  return request;
}

// Every direct and indirect report of a manager, walked from the jefe graph
// (not a fixed role/area pool), so "My Team" reflects the real hierarchy.
export async function teamMemberIds(managerId) {
  const ids = new Set();
  let frontier = [managerId];
  while (frontier.length) {
    const reports = await User.find({ jefe: { $in: frontier } }).select("_id").lean();
    const next = reports.map((report) => String(report._id)).filter((id) => !ids.has(id));
    next.forEach((id) => ids.add(id));
    frontier = next;
  }
  return [...ids];
}

export async function listRequestsPage(queryParams, user) {
  const query = {};
  if (queryParams.ownScope) {
    // "My Requests": only what this user raised. Team members' requests live
    // under My Team, even when this user is on their approval route.
    query.$or = [{ requester: user._id }, { solicitor: user._id }];
  } else if (queryParams.teamScope) {
    // My Team: submitted requests from this user's own hierarchy - never the
    // team's drafts, and for Admin too only its own team, not everything.
    const teamIds = await teamMemberIds(user._id);
    query.$and = [...(query.$and || []), { status: { $ne: REQUEST_STATUS.DRAFT } }, { $or: teamIds.length ? [{ requester: { $in: teamIds } }, { solicitor: { $in: teamIds } }] : [{ _id: null }] }];
  } else {
    Object.assign(query, requestVisibilityFilter(user));
  }
  if (queryParams.status === "RENDICION_PENDIENTE") { query.flowType = "C"; query["rendition.status"] = { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }; query.status = { $nin: terminalStatusValues }; }
  // Dashboard drill-down: Track A1 requests with committed budget still waiting for a Purchase Order.
  else if (queryParams.status === "PENDIENTE_OC") { query.flowType = "A1"; query.status = REQUEST_STATUS.BUDGET_COMMITTED; query.purchaseOrder = null; }
  // A comma-separated list selects any of several statuses (e.g. DEVUELTO,OBSERVADO).
  else if (queryParams.status) query.status = { $in: [...new Set(String(queryParams.status).split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) => statusAliases(canonicalRequestStatus(value))))] };
  applyRenditionStatusFilter(query, queryParams.renditionStatus);
  if (queryParams.type || queryParams.requestType) query.requestType = queryParams.type || queryParams.requestType;
  if (queryParams.flowType) query.flowType = queryParams.flowType;
  if (queryParams.expenseNature) query.expenseNature = queryParams.expenseNature;
  if (queryParams.priority) query.priority = { $in: String(queryParams.priority).split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) };
  if (queryParams.frequency) query.frequency = queryParams.frequency;
  if (queryParams.period) query.accountingPeriod = queryParams.period;
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.supplier) query.supplier = queryParams.supplier;
  if (queryParams.project) query.project = queryParams.project;
  if (queryParams.costCenter) query["lines.costCenter"] = queryParams.costCenter;
  if (queryParams.area) query.$and = [...(query.$and || []), { $or: [{ requesterArea: queryParams.area }, { requestingArea: queryParams.area }] }];
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, userIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { normalizedIdentifier: search }, { rucDni: search }] }),
      User.distinct("_id", { $or: [{ name: search }, { email: search }, { area: search }] })
    ]);
    query.$and = [...(query.$and || []), { $or: [
      { requestNumber: search },
      { areaCorrelative: search },
      { title: search },
      { description: search },
      { requesterArea: search },
      { requestingArea: search },
      { "supplierSnapshot.legalName": search },
      { "supplierSnapshot.identifier": search },
      { supplier: { $in: supplierIds } },
      { requester: { $in: userIds } },
      { solicitor: { $in: userIds } }
    ] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  let sort = parseSort(queryParams, ["requestNumber", "flowType", "requestType", "expenseNature", "priority", "issueDate", "accountingPeriod", "status", "totalAmount", "totalPENEquivalent", "createdAt", "updatedAt"], { createdAt: -1 });
  // Priority sorts Alta > Media > Baja (its rank), newest first within each.
  if (sort.priority) sort = { priorityRank: sort.priority, createdAt: -1 };
  const [data, total] = await Promise.all([
    FinancialRequest.find(query).select(requestListSelect).populate(requestListPopulate).sort(sort).skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query)
  ]);
  const progress = await getFinancialProgressForRequests(data);
  // canView tells list screens (My Team especially) whether a row may link to its
  // detail page: listing a team request does not by itself grant opening it.
  const rows = data.map(record => ({ ...record.toObject(), status: canonicalRequestStatus(record.status), financialProgress: progress.get(String(record._id)), allowedActions: allowedRequestActions(record, user), canView: canViewRequest(record, user) }));
  return paginatedPayload(rows, total, page, pageSize);
}

export async function getRequestDetail(id, user) {
  const request = await FinancialRequest.findById(id).populate(requestPopulate);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  const [accountsPayable, journalEntries, paymentBatches, reconciliation, audit, budgetPreview, procurementReadiness, sunatVouchers, massUploadBatches, invoiceObservations] = await Promise.all([
    AccountsPayable.find({ request: request._id }).populate("supplier", "name legalName rucDni").populate("sunatVoucher").populate("purchaseOrder", "poNumber remainingAmount currency status").sort({ createdAt: 1 }),
    JournalEntry.find({ request: request._id }).sort({ accountingDate: 1, createdAt: 1 }),
    PaymentBatch.find({ "items.request": request._id }).select("-filePath").sort({ generatedAt: -1 }),
    Reconciliation.findOne({ request: request._id }).populate("reconciledBy", "name email role"),
    AuditLog.find({ $or: [{ requestId: request._id }, { entityType: "FinancialRequest", entityId: request._id }] })
      .populate("user", "name email role").sort({ createdAt: 1 }),
    previewBudget(request).catch((error) => ({ status: "PENDING_VALIDATION", errorCode: error.code || ERROR_CODES.VALIDATION_ERROR, lines: [] })),
    evaluateProcurementReadiness(request),
    SunatVoucher.find({ request: request._id }).select("-xmlPath -pdfPath").populate("accountsPayable").populate("batch", "batchCode status").sort({ createdAt: 1 }),
    MassUploadBatch.find({ request: request._id }).select("-inputFile.path").populate("purchaseOrder", "poNumber originalAmount consumedAmount remainingAmount currency status").sort({ createdAt: -1 }),
    InvoiceObservation.find({ request: request._id }).select("-xmlPath -pdfPath").populate("batch", "batchCode status").populate("purchaseOrder", "poNumber remainingAmount currency status").sort({ updatedAt: -1 })
  ]);
  const financialProgress = await getFinancialProgress(request);
  const hasActiveObligations = accountsPayable.some(item => item.status !== "CANCELLED");
  const closureReady = canonicalRequestStatus(request.status) === REQUEST_STATUS.RECONCILED
    && financialProgress?.status === REQUEST_STATUS.RECONCILED
    && renditionSettledForClosure(request)
    && !Number(request.rendition?.nonDeductibleOutstanding || 0);
  return {
    request,
    allowedActions: allowedRequestActions(request, user, {
      hasActiveObligations,
      closureReady,
      procurementReady: Boolean(procurementReadiness?.readyForOrderCreation)
    }),
    budgetExceptions: await BudgetException.find({ request: request._id }).lean(),
    financialProgress,
    reconciliations: await Reconciliation.find({ request: request._id }).populate("reconciledBy", "name email role"),
    accountsPayable: serializePaymentRecords(accountsPayable, user),
    journalEntries,
    paymentBatches: serializePaymentBatches(paymentBatches, user),
    reconciliation,
    audit,
    budgetPreview,
    procurementReadiness,
    sunatVouchers,
    massUploadBatches,
    invoiceObservations,
    // An advance shows the employee where to return unspent money.
    advanceReturnAccount: request.flowType === FLOW_TYPE.C && request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? await advanceReturnAccount() : undefined
  };
}

export function applyRenditionStatusFilter(query, rawStatus) {
  if (!rawStatus) return query;
  const values = String(rawStatus).split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
  const expanded = values.flatMap(value => value === "RENDICION_PENDIENTE" ? ["PENDING", "SUBMITTED", "OBSERVED"] : [value]);
  if (expanded.length) query["rendition.status"] = { $in: [...new Set(expanded)] };
  return query;
}

export async function getRequestProcurementReadiness(id, user) {
  const request = await FinancialRequest.findById(id).populate(requestPopulate);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  return evaluateProcurementReadiness(request);
}

export async function createFinancialRequest({ payload, files, user, req }) {
  const requestedFlow = payload.flowType || (TRACK_C_REQUEST_TYPES.has(payload.requestType) ? FLOW_TYPE.C : FLOW_TYPE.A1);
  if (requestedFlow === FLOW_TYPE.A2) {
    throw new AppError(422, "Track A2 starts from an existing approved Purchase Order in the batch-invoice workspace.", { flowType: requestedFlow }, ERROR_CODES.VALIDATION_ERROR);
  }
  const normalizedRequestType = normalizeRequestTypeForTrack(requestedFlow, payload.requestType);
  const lines = parseRequestLines(payload.lines);
  const accountingPeriod = payload.accountingPeriod || periodFromDate(payload.issueDate);
  await guardAccountingPeriod({ period: accountingPeriod, action: "CREATE", user, req, module: "REQUESTS", entityType: "FinancialRequest" });
  const request = new FinancialRequest({
    flowType: requestedFlow,
    requestType: normalizedRequestType,
    expenseNature: payload.expenseNature,
    priority: parsePriority(payload.priority),
    frequency: parseFrequency(payload.frequency),
    observations: payload.observations,
    invoiceDetails: parseInvoiceDetails(payload.invoiceDetails),
    supplierPaymentTerms: parseSupplierPaymentTerms(payload.supplierPaymentTerms),
    requester: user._id,
    solicitor: user._id,
    requesterArea: user.area,
    requestingArea: user.area,
    requesterCostCenter: payload.requesterCostCenter || user.costCenter,
    costCenterType: parseCostCenterType(payload.costCenterType),
    costAllocations: payload.costAllocations === undefined ? undefined : parseCostAllocations(payload.costAllocations),
    schoolOrDepartment: payload.schoolOrDepartment || user.area,
    project: payload.project,
    issueDate: payload.issueDate,
    accountingPeriod,
    currency: payload.currency,
    supplier: payload.supplier,
    description: payload.description,
    areaCorrelative: payload.areaCorrelative,
    title: payload.title,
    detailedDescription: payload.detailedDescription,
    businessJustification: payload.businessJustification,
    nonApprovalRisk: payload.nonApprovalRisk,
    capexDetails: parseCapexDetails(payload.capexDetails),
    opexDetails: parseOpexDetails(payload.opexDetails),
    quotations: parseQuotations(payload.quotations),
    supplierSelectionReason: payload.supplierSelectionReason,
    lines,
    draftSavedAt: new Date()
  });
  request.$locals.paymentAccountId = payload.paymentAccount || null;
  let persistedFiles = {};
  let saved = false;
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    request.attachments.push(...mapAttachments(persistedFiles, user._id));
    const submit = parseBoolean(payload.submit);
    await prepareRequest(request, { user, files: persistedFiles, validateSubmission: submit });
    request.approvalHistory.push(workflowEvent({ action: "CREATED", to: REQUEST_STATUS.DRAFT, user, req, comments: "Draft created.", request }));
    await request.save();
    saved = true;
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "CREATED", user, req, module: "REQUESTS", newValues: { status: request.status, ...officialAuditSnapshot(request) } });
    if (submit) await submitPreparedRequest(request, { user, req, comments: payload.comments });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!saved) await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
}

export async function updateFinancialRequest({ id, payload, files, user, req }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user)) throw new AppError(403, "This request cannot be modified in its current state.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  if (payload.flowType === FLOW_TYPE.A2) {
    throw new AppError(422, "Track A2 is not a request form; use the Purchase Order batch workspace.", { flowType: payload.flowType }, ERROR_CODES.VALIDATION_ERROR);
  }
  const nextPeriod = payload.accountingPeriod || request.accountingPeriod;
  await guardAccountingPeriod({ period: nextPeriod, action: "UPDATE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  const oldValues = {
    status: request.status,
    supplier: request.supplier,
    totalAmount: request.totalAmount,
    accountingPeriod: request.accountingPeriod,
    officialRequest: officialAuditSnapshot(request)
  };
  request.$locals.previousSupplierIds = [request.supplier, ...(request.quotations || []).map((quotation) => quotation.supplier)].filter(Boolean).map((id) => String(id?._id || id));
  if (payload.lines !== undefined) request.lines = parseRequestLines(payload.lines);
  applyEditableFields(request, payload);
  const removedAttachments = removeRequestAttachments(request, payload.removeAttachments);
  request.draftSavedAt = new Date();
  let persistedFiles = {};
  let saved = false;
  try {
    persistedFiles = await persistUploadedFiles(files, { domain: "requests", entityId: request._id });
    request.attachments.push(...mapAttachments(persistedFiles, user._id));
    const submit = parseBoolean(payload.submit);
    await prepareRequest(request, { user, files: persistedFiles, validateSubmission: submit });
    if (request.observation?.observedAt && [REQUEST_STATUS.OBSERVED, REQUEST_STATUS.OBSERVED_BUDGET, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, REQUEST_STATUS.OBSERVED_BATCH].includes(request.status)) {
      request.observation.resolvedAt = new Date();
      request.observation.resolvedBy = user._id;
    }
    await request.save();
    saved = true;
    await recordAudit({
      entityType: "FinancialRequest",
      entity: request,
      action: "UPDATED",
      user,
      req,
      module: "REQUESTS",
      oldValues,
      newValues: {
        supplier: request.supplier,
        totalAmount: request.totalAmount,
        accountingPeriod: request.accountingPeriod,
        officialRequest: officialAuditSnapshot(request),
        ...(removedAttachments.length ? { removedAttachments: removedAttachments.map((attachment) => ({ kind: attachment.kind, originalName: attachment.originalName, url: attachment.url })) } : {})
      }
    });
    // A draft never sent drops the file itself; once approvers have seen a file it stays in storage,
    // traceable from the audit entry above.
    if (removedAttachments.length && !wasSubmitted(request)) await cleanupUploadedFiles({ attachments: removedAttachments.filter((attachment) => attachment.path) });
    if (submit) await submitPreparedRequest(request, { user, req, comments: payload.comments });
    await request.populate(requestPopulate);
    return request;
  } catch (error) {
    if (!saved) await cleanupUploadedFiles(persistedFiles);
    throw error;
  }
}

export async function submitFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (request.purchaseOrder) throw new AppError(409, "This request already has an issued order. Correct the invoice in Documents; do not resubmit the request for approval.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  if (!canModifyRequest(request, user)) throw new AppError(403, "This request cannot be submitted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "SUBMIT", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await prepareRequest(request, { user, validateSubmission: true });
  await submitPreparedRequest(request, { user, req, comments });
  await request.populate(requestPopulate);
  return request;
}

// The requester takes a submitted request back to draft before their first
// approver decides, to correct and resubmit it. The open steps are closed as
// SKIPPED (the next submission resolves a fresh route anyway) and the approver's
// pending task and SLA alerts are resolved.
export async function withdrawFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canWithdrawRequest(request, user)) {
    throw new AppError(409, "Only the requester can withdraw a request, and only while it is pending approval and no approver has approved it yet.", { status: canonicalRequestStatus(request.status) }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const withdrawnAt = new Date();
  const pendingApprovers = [];
  for (const step of request.approvalRouteSnapshot || []) {
    if (["PENDING", "NOT_REACHED"].includes(step.status)) {
      if (step.status === "PENDING" && step.approverUser) pendingApprovers.push(step.approverUser);
      step.status = "SKIPPED";
      step.completedAt = withdrawnAt;
    }
  }
  await transitionRequest({
    request,
    targetStatus: REQUEST_STATUS.DRAFT,
    user,
    req,
    action: "WITHDRAWN",
    comments: String(comments || "").trim() || "Withdrawn by the requester before the first approval.",
    dueAt: null,
    skipControls: true,
    skipRoleCheck: true
  });
  await resolveApprovalNotifications(request._id);
  await recordAudit({
    entityType: "FinancialRequest",
    entity: request,
    action: "REQUEST_WITHDRAWN",
    user,
    req,
    module: "APPROVALS",
    comments: String(comments || "").trim() || undefined,
    oldValues: { status: REQUEST_STATUS.PENDING_APPROVAL, pendingApprovers },
    newValues: { status: REQUEST_STATUS.DRAFT }
  });
  await request.populate(requestPopulate);
  return request;
}

export async function voidFinancialRequest({ id, user, req, comments }) {
  const reason = String(comments || "").trim();
  if (!reason) throw new AppError(422, "A void reason is required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "VOID", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  assertRequestActive(request);
  const obligations = await AccountsPayable.exists({ request: request._id, status: { $ne: "CANCELLED" } });
  if (obligations) throw new AppError(409, "A request with financial obligations cannot be voided through ordinary cancellation. Accounting must resolve the obligations first.");
  await runFinancialOperation(async session => {
    // Validate the transition before changing any budget balances.
    if (!canTransition(request.status, REQUEST_STATUS.VOIDED)) throw new AppError(409, "This request cannot be cancelled at its current stage.");
    await releaseBudget(request, user._id, reason, { session });
    await cancelProcurementOnVoid({ request, user, req, reason, session });
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.VOIDED, user, req, action: "VOIDED", comments: reason, session });
  });
  await resolveRequestNotifications(request._id);
  await request.populate(requestPopulate);
  return request;
}

export async function closeFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "CLOSE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await assertClosureAllowed(request);
  await runFinancialOperation(async session => {
    await transitionRequest({ request, targetStatus: REQUEST_STATUS.CLOSED, user, req, action: "CLOSED", comments: comments || "All obligations reconciled and financial file closed.", session });
    await settleProcurementAtClosure({ request, user, req, session });
  });
  await resolveNotification(`request:${request._id}:close`);
  await request.populate(requestPopulate);
  return request;
}

export async function deleteFinancialRequest({ id, user, req }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user) || request.status !== REQUEST_STATUS.DRAFT) {
    throw new AppError(403, "Only permitted draft requests can be deleted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  }
  if (wasSubmitted(request)) {
    throw new AppError(409, "This request was already sent for approval; its history is kept. Void it instead of deleting it.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "DELETE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await recordAudit({ entityType: "FinancialRequest", entity: request, action: "DELETED", user, req, module: "REQUESTS", oldValues: { status: request.status, requestNumber: request.requestNumber } });
  await request.deleteOne();
  await cleanupUploadedFiles({ attachments: request.attachments.filter((attachment) => attachment.path) });
  return request;
}

export async function requestDocumentRequirements(query) {
  const flowType = query.flowType || FLOW_TYPE.A1;
  const requestType = normalizeRequestTypeForTrack(flowType, query.requestType);
  return configuredDocumentRequirements({ flowType, requestType, expenseNature: query.expenseNature, attachments: [] }, query.phase || DOCUMENT_PHASE.SUBMISSION);
}

export async function requestDocumentStatus(id, user) {
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You cannot view this request.", undefined, ERROR_CODES.FORBIDDEN);
  return documentStatusByPhase(request);
}

export async function requestFormPolicy(query) {
  const flowType = query.flowType || FLOW_TYPE.A1;
  const requestType = normalizeRequestTypeForTrack(flowType, query.requestType);
  const request = { flowType, requestType, expenseNature: query.expenseNature, attachments: [] };
  const [documentRequirements, quotationPolicy, capexThreshold] = await Promise.all([
    configuredDocumentRequirements(request, DOCUMENT_PHASE.SUBMISSION),
    configuredQuotationPolicy(request),
    getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.CAPEX_DETAILS_THRESHOLD)
  ]);
  const threshold = Number(capexThreshold?.numericValue);
  return { documentRequirements, quotationPolicy, capexDetailsThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_CAPEX_DETAILS_THRESHOLD };
}

export async function requestAuthorizedCostCenters(user) {
  const query = { active: true };
  if (user.role !== ROLES.ADMIN && actsAsRequester(user)) {
    const allowed = [user.costCenter, ...(user.authorizedCostCenters || [])]
      .filter(Boolean)
      .map((value) => value?._id || value);
    query._id = { $in: allowed };
  }
  return CostCenter.find(query).select("code name area organizationalUnit organizationalUnitCode active annualBudget committedAmount executedAmount paidAmount budgetMode availableAmount importProvenance").sort({ code: 1 });
}

// The schools and departments a request can be made Por Encargo for: every active CECO of the
// master, by code. Only what identifies it; their budgets are not shown here.
export async function requestBeneficiaryCostCenters() {
  return CostCenter.find({ active: true }).select("code name area organizationalUnit organizationalUnitCode").sort({ code: 1 }).lean();
}

export async function previewFinancialRequestBudget({ payload, user }) {
  const flowType = payload.flowType || FLOW_TYPE.A1;
  const requestType = normalizeRequestTypeForTrack(flowType, payload.requestType);
  const lines = parseRequestLines(payload.lines);
  // Por Encargo previews the beneficiary CECOs' budgets, with the shares the request would take.
  const onBehalf = flowType !== FLOW_TYPE.C && parseCostCenterType(payload.costCenterType) === COST_CENTER_TYPE.ON_BEHALF;
  const costAllocations = onBehalf ? parseCostAllocations(payload.costAllocations) : [];
  if (onBehalf) {
    const problems = costAllocationProblems(costAllocations);
    if (problems.length) throw new AppError(422, problems[0].message, { field: problems[0].field, problems }, ERROR_CODES.INVALID_COST_ALLOCATION);
    for (const line of lines) line.costCenter = costAllocations[0].costCenter;
  }
  assertRequestLines(lines);
  await validateAccountingDimensions({
    requestType,
    expenseNature: payload.expenseNature,
    lines,
    user: onBehalf ? undefined : user
  });
  const percentage = payload.scenario?.percentage === undefined ? 100 : Number(payload.scenario.percentage);
  const period = payload.scenario?.period || payload.accountingPeriod;
  if (!Number.isFinite(percentage) || percentage < 1 || percentage > 300 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new AppError(422, "Choose a valid month and an amount between 1% and 300% of the request.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!["PEN", "USD"].includes(payload.currency)) throw new AppError(422, "Unsupported currency.", undefined, ERROR_CODES.VALIDATION_ERROR);
  let snapshot;
  try { snapshot = await resolveExchangeRateSnapshot(payload.currency, payload.issueDate); }
  catch (error) {
    if (error.code !== ERROR_CODES.EXCHANGE_RATE_MISSING) throw error;
    return { status: "PENDING_VALIDATION", reason: error.code, totalRequested: 0, lines: [] };
  }
  const exchangeRate = snapshot.rate;
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return { status: "PENDING_VALIDATION", reason: ERROR_CODES.EXCHANGE_RATE_MISSING, totalRequested: 0, lines: [] };
  for (const line of lines) {
    line.currency = payload.currency;
    line.exchangeRate = exchangeRate;
    // Simulation changes only these in-memory preview amounts, never the request.
    line.totalAmount = multiplyMoney(line.totalAmount, percentage / 100);
    line.penEquivalent = multiplyMoney(line.totalAmount, exchangeRate);
  }
  const preview = await previewBudget({
    requestType,
    expenseNature: payload.expenseNature,
    issueDate: payload.issueDate,
    accountingPeriod: period,
    project: payload.project,
    lines,
    ...(onBehalf ? { costCenterType: COST_CENTER_TYPE.ON_BEHALF, costAllocations } : {})
  });
  return { ...preview, asOf: new Date().toISOString(), period, exchangeRate, exchangeRateDate: snapshot.date,
    scenarioPercentage: percentage, deferredCommitment: flowType === FLOW_TYPE.C };
}

export function publicRequestPayload(value, user, actionContext) {
  const object = value?.toObject ? value.toObject() : plainClone(value);
  if (object?.status) object.status = canonicalRequestStatus(object.status);
  if (object && user && !object.allowedActions) object.allowedActions = allowedRequestActions(value, user, actionContext);
  if (object) object.observationOwner = observationOwner(value);
  for (const attachment of object?.attachments || []) delete attachment.path;
  return object;
}
