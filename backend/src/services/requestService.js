import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import CostCenter from "../models/CostCenter.js";
import Project from "../models/Project.js";
import AuditLog from "../models/AuditLog.js";
import AccountsPayable from "../models/AccountsPayable.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Reconciliation from "../models/Reconciliation.js";
import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";
import SunatVoucher from "../models/SunatVoucher.js";
import MassUploadBatch from "../models/MassUploadBatch.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import { recordAudit, workflowEvent } from "./auditService.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { initializeApprovalRoute } from "./approvalRuleService.js";
import {
  assertConfiguredDocuments,
  configuredDocumentRequirements,
  configuredQuotationPolicy,
  validateStructuredQuotationComparison
} from "./documentRuleService.js";
import { applyExchangeRate } from "./exchangeRateService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { notifyRoles, resolveNotification } from "./notificationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { assertRequestLines } from "./requestRules.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import { assertSupplierEligibleForRequestReview, assertSupplierUsable } from "./supplierService.js";
import { transitionRequest } from "./workflowService.js";
import { validateXmlAgainstRequest } from "./xmlValidationService.js";
import { previewBudget, releaseBudget } from "./budgetService.js";
import { evaluateProcurementReadiness } from "./procurementReadinessService.js";
import { AppError } from "../utils/AppError.js";
import {
  ERROR_CODES,
  FLOW_TYPE,
  REQUEST_STATUS,
  REQUEST_TYPE,
  ROLES
} from "../utils/constants.js";
import { canModifyRequest, canUseCostCenter, canViewRequest } from "../utils/permissions.js";
import { multiplyMoney } from "../utils/money.js";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";

export const requestPopulate = [
  { path: "supplier" },
  { path: "requester", select: "name email role area costCenter authorizedCostCenters" },
  { path: "solicitor", select: "name email role area costCenter authorizedCostCenters" },
  { path: "requesterCostCenter" },
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
  "schoolOrDepartment", "flowType", "requestType", "expenseNature", "priority", "project", "areaCorrelative", "title", "currency", "exchangeRate",
  "totalNet", "totalIGV", "totalAmount", "totalPENEquivalent", "supplier", "supplierSnapshot", "status",
  "description", "approvalStage", "approvalDueAt", "createdAt", "updatedAt"
].join(" ");

export const requestListPopulate = [
  { path: "supplier", select: "supplierCode name commercialName legalName rucDni normalizedIdentifier homologationStatus active" },
  { path: "requester", select: "name email role area" },
  { path: "solicitor", select: "name email role area" }
];

const attachmentKinds = Object.freeze({
  xml: "XML",
  pdf: "PDF",
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

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

const A1_B_EXPENDITURE_CLASSIFICATIONS = new Set([REQUEST_TYPE.OPEX, REQUEST_TYPE.CAPEX]);

export function normalizeRequestTypeForTrack(flowType, requestType) {
  const normalizedFlow = flowType || FLOW_TYPE.A1;

  if (normalizedFlow === FLOW_TYPE.C) return REQUEST_TYPE.ENTREGA_RENDIR;

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
      expenseType: line.expenseType?._id || line.expenseType,
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
  if (user.role === ROLES.SOLICITOR && !canUseCostCenter(user, center._id)) {
    throw new AppError(
      403,
      `CECO ${center.code} - ${center.name} is not assigned to the current requester.`,
      { costCenter: center._id, code: center.code, name: center.name, area: center.area },
      ERROR_CODES.INVALID_COST_CENTER
    );
  }
  request.requesterCostCenter = center._id;
  return center;
}

function assertOfficialRequestFields(request) {
  const required = [
    ["title", "TITLE_REQUIRED", "Requirement title is required."],
    ["detailedDescription", "DETAILED_DESCRIPTION_REQUIRED", "Detailed description is required."],
    ["businessJustification", "BUSINESS_JUSTIFICATION_REQUIRED", "Business justification is required."],
    ["nonApprovalRisk", "NON_APPROVAL_RISK_REQUIRED", "Risk if not approved is required."]
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
    areaCorrelative: request.areaCorrelative,
    title: request.title,
    detailedDescription: request.detailedDescription,
    businessJustification: request.businessJustification,
    nonApprovalRisk: request.nonApprovalRisk,
    capexDetails: request.capexDetails,
    opexDetails: request.opexDetails,
    quotationCount: request.quotations?.length || 0,
    recommendedSupplier: recommended?.supplier?._id || recommended?.supplier,
    supplierSelectionReason: request.supplierSelectionReason
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
    "supplierSelectionReason",
    "issueDate",
    "accountingPeriod",
    "currency",
    "supplier",
    "description"
  ];
  for (const field of fields) if (payload[field] !== undefined) request[field] = payload[field];
  if (payload.requesterCostCenter !== undefined) request.requesterCostCenter = payload.requesterCostCenter?._id || payload.requesterCostCenter;
  if (payload.capexDetails !== undefined) request.capexDetails = parseCapexDetails(payload.capexDetails);
  if (payload.opexDetails !== undefined) request.opexDetails = parseOpexDetails(payload.opexDetails);
  if (payload.quotations !== undefined) request.quotations = parseQuotations(payload.quotations);
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
  }

  if (request.flowType !== FLOW_TYPE.A1) {
    request.quotations = [];
    request.supplierSelectionReason = "";
  }
}

async function prepareRequest(request, { user, files = {}, validateSubmission = false }) {
  normalizeTrackFields(request);
  const officialRequest = isOfficialCapexOpexRequest(request);
  assertRequestLines(request.lines);
  await validateAccountingDimensions({
    requestType: request.requestType,
    expenseNature: request.expenseNature,
    lines: request.lines,
    user
  });
  const supplier = request.flowType === FLOW_TYPE.C ? null : await Supplier.findById(request.supplier?._id || request.supplier);
  if (request.flowType !== FLOW_TYPE.C && !supplier) throw new AppError(404, "Supplier not found.", { supplier: request.supplier }, ERROR_CODES.NOT_FOUND);
  if (supplier) request.supplierSnapshot = supplierSnapshot(supplier);
  linkQuotationEvidence(request);
  await applyQuotationSnapshots(request);
  request.requesterCostCenter ||= user.costCenter;
  await validateHeaderCostCenter(request, user, { required: validateSubmission });
  await applyProjectSnapshot(request);
  await applyExchangeRate(request);
  await request.validate();

  const xmlAttachment = [...(request.attachments || [])].reverse().find((attachment) => attachment.kind === "XML");
  if (xmlAttachment) {
    request.xmlValidation = await validateXmlAgainstRequest(xmlAttachment.path, {
      supplier,
      fiscalData: request.fiscalData,
      totalNet: request.totalNet,
      totalIGV: request.totalIGV,
      totalAmount: request.totalAmount,
      issueDate: request.issueDate
    }, {
      request,
      requestNumber: request.requestNumber,
      supplier,
      user,
      fileName: xmlAttachment.originalName
    });
    request.xmlValidationHistory.push(request.xmlValidation);
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
      const overdue = await FinancialRequest.findOne({
        _id: { $ne: request._id },
        requester: request.requester,
        flowType: FLOW_TYPE.C,
        "rendition.dueAt": { $lt: new Date() },
        "rendition.status": { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }
      }).select("requestNumber rendition.dueAt");
      if (overdue) throw new AppError(409, "A new advance is blocked because the employee has a rendition overdue by more than the allowed 10-day period.", { overdueRequest: overdue.requestNumber, dueAt: overdue.rendition?.dueAt }, ERROR_CODES.OVERDUE_RENDITION);
    } else if (request.flowType === FLOW_TYPE.A1) {
      if (officialRequest) assertOfficialRequestFields(request);
      assertSupplierEligibleForRequestReview(supplier);
      await assertQuotationPolicy(request);
    } else {
      assertSupplierUsable(supplier);
    }
    await assertConfiguredDocuments(request);
    if (request.flowType === FLOW_TYPE.B && !request.xmlValidation?.validated) {
      throw new AppError(422, "A valid XML fiscal document is required.", { requestType: request.requestType }, ERROR_CODES.XML_VALIDATION_FAILED);
    }
  }
  return { supplier, files };
}

async function submitPreparedRequest(request, { user, req, comments }) {
  await initializeApprovalRoute(request);
  request.rejectionReason = "";
  await request.save();
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.VALIDATION, user, req, action: "VALIDATION_STARTED", comments });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.SENT, user, req, action: "SUBMITTED", comments });
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
  await notifyRoles({
    roles: ["Approver", "Management"],
    approvalLevel: request.approvalStage,
    areas: request.approvalStage === "AREA_DIRECTOR" ? [request.requesterArea || request.requestingArea] : undefined,
    eventKey: `request:${request._id}:approval:${request.approvalStage}`,
    type: "APPROVAL_PENDING",
    title: "Approval pending",
    message: `${request.requestNumber} is waiting for ${request.approvalStage} approval.`,
    path: `/approvals?request=${request._id}`,
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return request;
}

export async function listRequestsPage(queryParams, user) {
  const query = {};
  if (user.role === ROLES.SOLICITOR) query.$or = [{ requester: user._id }, { solicitor: user._id }];
  if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role)) query.status = { $ne: REQUEST_STATUS.DRAFT };
  if (queryParams.status) query.status = queryParams.status;
  if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role) && queryParams.status === REQUEST_STATUS.DRAFT) query.status = "__FORBIDDEN_DRAFT__";
  if (queryParams.type || queryParams.requestType) query.requestType = queryParams.type || queryParams.requestType;
  if (queryParams.flowType) query.flowType = queryParams.flowType;
  if (queryParams.expenseNature) query.expenseNature = queryParams.expenseNature;
  if (queryParams.priority) query.priority = queryParams.priority;
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
  const sort = parseSort(queryParams, ["requestNumber", "flowType", "requestType", "expenseNature", "priority", "issueDate", "accountingPeriod", "status", "totalAmount", "totalPENEquivalent", "createdAt", "updatedAt"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    FinancialRequest.find(query).select(requestListSelect).populate(requestListPopulate).sort(sort).skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query)
  ]);
  return paginatedPayload(data, total, page, pageSize);
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
  return {
    request,
    accountsPayable: serializePaymentRecords(accountsPayable, user),
    journalEntries,
    paymentBatches: serializePaymentBatches(paymentBatches, user),
    reconciliation,
    audit,
    budgetPreview,
    procurementReadiness,
    sunatVouchers,
    massUploadBatches,
    invoiceObservations
  };
}

export async function getRequestProcurementReadiness(id, user) {
  const request = await FinancialRequest.findById(id).populate(requestPopulate);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canViewRequest(request, user)) throw new AppError(403, "You do not have permission to view this request.", undefined, ERROR_CODES.FORBIDDEN);
  return evaluateProcurementReadiness(request);
}

export async function createFinancialRequest({ payload, files, user, req }) {
  const requestedFlow = payload.flowType || (payload.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? FLOW_TYPE.C : FLOW_TYPE.A1);
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
    priority: payload.priority,
    requester: user._id,
    solicitor: user._id,
    requesterArea: user.area,
    requestingArea: user.area,
    requesterCostCenter: payload.requesterCostCenter || user.costCenter,
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
    await recordAudit({ entityType: "FinancialRequest", entity: request, action: "CREATED", user, req, module: "REQUESTS", newValues: { status: request.status } });
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
  if (payload.lines !== undefined) request.lines = parseRequestLines(payload.lines);
  applyEditableFields(request, payload);
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
        officialRequest: officialAuditSnapshot(request)
      }
    });
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
  if (!canModifyRequest(request, user)) throw new AppError(403, "This request cannot be submitted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "SUBMIT", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await prepareRequest(request, { user, validateSubmission: true });
  await submitPreparedRequest(request, { user, req, comments });
  await request.populate(requestPopulate);
  return request;
}

export async function voidFinancialRequest({ id, user, req, comments }) {
  const reason = String(comments || "").trim();
  if (!reason) throw new AppError(422, "A void reason is required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "VOID", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await releaseBudget(request, user._id, reason);
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.VOIDED, user, req, action: "VOIDED", comments: reason });
  await request.populate(requestPopulate);
  return request;
}

export async function closeFinancialRequest({ id, user, req, comments }) {
  const request = await FinancialRequest.findById(id);
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "CLOSE", user, req, module: "REQUESTS", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await transitionRequest({ request, targetStatus: REQUEST_STATUS.PAID_CLOSED, user, req, action: "PAID_CLOSED", comments: comments || "Payment completed and financial file closed." });
  await resolveNotification(`request:${request._id}:close`);
  await request.populate(requestPopulate);
  return request;
}

export async function deleteFinancialRequest({ id, user, req }) {
  const request = await FinancialRequest.findById(id).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (!canModifyRequest(request, user) || ![REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED].includes(request.status)) {
    throw new AppError(403, "Only permitted draft or rejected requests can be deleted.", { status: request.status }, ERROR_CODES.FORBIDDEN);
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
  return configuredDocumentRequirements({ flowType, requestType, expenseNature: query.expenseNature, attachments: [] });
}

export async function requestFormPolicy(query) {
  const flowType = query.flowType || FLOW_TYPE.A1;
  const requestType = normalizeRequestTypeForTrack(flowType, query.requestType);
  const request = { flowType, requestType, expenseNature: query.expenseNature, attachments: [] };
  const [documentRequirements, quotationPolicy] = await Promise.all([
    configuredDocumentRequirements(request),
    configuredQuotationPolicy(request)
  ]);
  return { documentRequirements, quotationPolicy };
}

export async function requestAuthorizedCostCenters(user) {
  const query = { active: true };
  if (user.role === ROLES.SOLICITOR) {
    const allowed = [user.costCenter, ...(user.authorizedCostCenters || [])]
      .filter(Boolean)
      .map((value) => value?._id || value);
    query._id = { $in: allowed };
  }
  return CostCenter.find(query).select("code name area active annualBudget committedAmount executedAmount paidAmount budgetMode availableAmount").sort({ code: 1 });
}

export async function previewFinancialRequestBudget({ payload, user }) {
  const flowType = payload.flowType || FLOW_TYPE.A1;
  const requestType = normalizeRequestTypeForTrack(flowType, payload.requestType);
  const lines = parseRequestLines(payload.lines);
  assertRequestLines(lines);
  await validateAccountingDimensions({
    requestType,
    expenseNature: payload.expenseNature,
    lines,
    user
  });
  const exchangeRate = payload.currency === "PEN" ? 1 : Number(payload.exchangeRate || 0);
  if (!(exchangeRate > 0)) {
    return { status: "PENDING_VALIDATION", reason: ERROR_CODES.EXCHANGE_RATE_MISSING, totalRequested: 0, lines: [] };
  }
  for (const line of lines) {
    line.currency = payload.currency;
    line.exchangeRate = exchangeRate;
    line.penEquivalent = multiplyMoney(line.totalAmount, exchangeRate);
  }
  return previewBudget({
    requestType,
    expenseNature: payload.expenseNature,
    issueDate: payload.issueDate,
    accountingPeriod: payload.accountingPeriod,
    project: payload.project,
    lines
  });
}

export function publicRequestPayload(value) {
  const object = value?.toObject ? value.toObject() : structuredClone(value);
  for (const attachment of object?.attachments || []) delete attachment.path;
  return object;
}
