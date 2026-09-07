import DocumentRule from "../models/DocumentRule.js";
import { validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import { AppError } from "../utils/AppError.js";
import {
  ERROR_CODES,
  EXPENSE_NATURE,
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  FLOW_TYPE,
  MANDATORY_XML_TYPES,
  REQUEST_TYPE
} from "../utils/constants.js";

function canonicalType(value) {
  return LEGACY_REQUEST_TYPE_MAP[value] || value;
}

function canonicalNature(value) {
  return LEGACY_EXPENSE_NATURE_MAP[value] || value;
}

function mergeRequirements(requirements) {
  const merged = new Map();
  for (const requirement of requirements) {
    const current = merged.get(requirement.kind);
    if (!current || requirement.minCount > current.minCount) merged.set(requirement.kind, requirement);
  }
  return [...merged.values()];
}

export function defaultDocumentRequirements(request) {
  const flowType = request.flowType || FLOW_TYPE.A1;
  if (flowType === FLOW_TYPE.B) {
    return [
      { kind: "XML", minCount: 1, labelKey: "invoice XML" },
      { kind: "PDF", minCount: 1, labelKey: "invoice PDF" }
    ];
  }
  if (flowType === FLOW_TYPE.C || flowType === FLOW_TYPE.A2) return [];
  return [{ kind: "QUOTATION", minCount: 3, labelKey: "three quotations" }];
}

export async function configuredDocumentRequirements(request) {
  if (request.flowType) return defaultDocumentRequirements(request);
  const requestType = canonicalType(request.requestType);
  const expenseNature = canonicalNature(request.expenseNature);
  const rules = await DocumentRule.find({ active: true, requestType: { $in: ["*", requestType] }, expenseNature: { $in: ["*", expenseNature] } }).sort({ requestType: 1, expenseNature: 1 });
  if (!rules.length) return defaultDocumentRequirements(request);
  return mergeRequirements(rules.flatMap((rule) => rule.requirements));
}

export function defaultQuotationPolicy(request) {
  const requirement = defaultDocumentRequirements(request).find((item) => item.kind === "QUOTATION");
  return {
    enabled: Boolean(requirement),
    minimumCount: requirement?.minCount || 3,
    allowAuthorizedException: true,
    exceptionReasonRequired: true,
    source: "DEFAULT_DOCUMENT_REQUIREMENTS"
  };
}

export async function configuredQuotationPolicy(request) {
  if (request.flowType) return defaultQuotationPolicy(request);
  const requestType = canonicalType(request.requestType);
  const expenseNature = canonicalNature(request.expenseNature);
  const rules = await DocumentRule.find({ active: true, requestType: { $in: ["*", requestType] }, expenseNature: { $in: ["*", expenseNature] } }).sort({ requestType: 1, expenseNature: 1 });
  if (!rules.length) return defaultQuotationPolicy(request);
  const quotationMinimums = rules.flatMap((rule) => [
    ...(rule.requirements || []).filter((item) => item.kind === "QUOTATION").map((item) => item.minCount),
    ...(rule.quotationPolicy?.enabled ? [rule.quotationPolicy.minimumCount] : [])
  ]);
  if (!quotationMinimums.length) return { ...defaultQuotationPolicy(request), source: "CONFIGURED_DOCUMENT_RULES" };
  return { enabled: true, minimumCount: Math.max(...quotationMinimums), allowAuthorizedException: rules.every((rule) => rule.quotationPolicy?.allowAuthorizedException !== false), exceptionReasonRequired: rules.some((rule) => rule.quotationPolicy?.exceptionReasonRequired !== false), source: "CONFIGURED_DOCUMENT_RULES", ruleCodes: rules.map((rule) => rule.code) };
}

export function validateStructuredQuotationComparison(request, policy = defaultQuotationPolicy(request)) {
  const paymentErrors = (request.quotations || []).flatMap((quotation, index) => validatePaymentTerms(quotation).map((error) => ({ code: "QUOTATION_PAYMENT_TERMS_INVALID", quotation: index + 1, ...error })));
  if (!policy.enabled) return { valid: paymentErrors.length === 0, applicable: false, policy, errors: paymentErrors };
  const quotations = request.quotations || [];
  const exception = request.quotationException || {};
  const exceptionAccepted = Boolean(exception.authorized && policy.allowAuthorizedException);
  const errors = [...paymentErrors];
  const supplierIds = quotations.map((quotation) => String(quotation.supplier?._id || quotation.supplier || "")).filter(Boolean);
  const uniqueSupplierIds = new Set(supplierIds);
  if (!exceptionAccepted && uniqueSupplierIds.size < policy.minimumCount) {
    errors.push({
      code: "QUOTATION_MINIMUM_NOT_MET",
      required: policy.minimumCount,
      present: uniqueSupplierIds.size
    });
  }
  if (exceptionAccepted && policy.exceptionReasonRequired && !String(exception.reason || "").trim()) {
    errors.push({ code: "QUOTATION_EXCEPTION_REASON_REQUIRED" });
  }
  if (quotations.some((quotation) => !quotation.supplier)) errors.push({ code: "QUOTATION_SUPPLIER_REQUIRED" });
  quotations.forEach((quotation, index) => {
    if (!quotation.attachment) errors.push({ code: "QUOTATION_ATTACHMENT_REQUIRED", quotation: index + 1 });
  });

  const recommended = quotations.filter((quotation) => quotation.recommended);
  if (recommended.length === 0) errors.push({ code: "NO_RECOMMENDED_QUOTATION", present: 0 });
  if (recommended.length > 1) errors.push({ code: "MULTIPLE_RECOMMENDED_QUOTATIONS", present: recommended.length });
  const selectedSupplier = String(request.supplier?._id || request.supplier || "");
  if (recommended.length === 1 && String(recommended[0].supplier?._id || recommended[0].supplier || "") !== selectedSupplier) {
    errors.push({ code: "RECOMMENDED_SUPPLIER_MISMATCH" });
  }
  if (!String(request.supplierSelectionReason || "").trim()) errors.push({ code: "SUPPLIER_SELECTION_REASON_REQUIRED" });
  return { valid: errors.length === 0, applicable: true, policy, exceptionAccepted, errors };
}

export function validateDocumentRequirements(request, requirements) {
  const counts = (request.attachments || []).reduce((map, attachment) => {
    map.set(attachment.kind, (map.get(attachment.kind) || 0) + 1);
    return map;
  }, new Map());
  const missing = requirements
    .map((requirement) => ({
      kind: requirement.kind,
      required: requirement.minCount,
      present: counts.get(requirement.kind) || 0,
      label: requirement.labelKey
    }))
    .filter((item) => item.present < item.required);
  return { valid: missing.length === 0, requirements, missing };
}

export async function assertConfiguredDocuments(request) {
  const result = validateDocumentRequirements(request, await configuredDocumentRequirements(request));
  if (!result.valid) {
    throw new AppError(
      422,
      "Mandatory evidence is missing.",
      { missing: result.missing, requirements: result.requirements },
      ERROR_CODES.MISSING_REQUIRED_DOCUMENT
    );
  }
  return result;
}
