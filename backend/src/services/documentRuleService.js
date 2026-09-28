import DocumentRule from "../models/DocumentRule.js";
import { validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import { AppError } from "../utils/AppError.js";
import {
  DOCUMENT_PHASE,
  DOCUMENT_PHASES,
  ERROR_CODES,
  EXPENSE_NATURE,
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  FLOW_TYPE
} from "../utils/constants.js";

function canonicalType(value) { return LEGACY_REQUEST_TYPE_MAP[value] || value; }
function canonicalNature(value) { return LEGACY_EXPENSE_NATURE_MAP[value] || value; }

// Product decision: quotations have no minimum amount and three quotations are not compulsory.
// Wherever quotations apply, at least one supplier quotation (with its evidence) is required and
// the requester may add or remove further quotations freely. Legacy DocumentRule records that
// still carry "3" (seeded before this decision) are normalized here, so no configuration can
// silently reintroduce the old three-quotation gate.
export const QUOTATION_MINIMUM_COUNT = 1;
function normalizeRequirement(requirement) {
  return requirement.kind === "QUOTATION"
    ? { kind: requirement.kind, labelKey: "at least one quotation", minCount: QUOTATION_MINIMUM_COUNT }
    : requirement;
}

function mergeRequirements(requirements) {
  const merged = new Map();
  for (const requirement of requirements.map(normalizeRequirement)) {
    const current = merged.get(requirement.kind);
    if (!current || requirement.minCount > current.minCount) merged.set(requirement.kind, requirement);
  }
  return [...merged.values()];
}

const goodsNatures = new Set([
  EXPENSE_NATURE.GOODS, EXPENSE_NATURE.EQUIPMENT, EXPENSE_NATURE.TECHNOLOGY,
  EXPENSE_NATURE.INFRASTRUCTURE, EXPENSE_NATURE.LABORATORIES, EXPENSE_NATURE.LIBRARY
]);

function requirement(kind, labelKey, minCount = 1) { return { kind, minCount, labelKey }; }

export function defaultDocumentRequirements(request, phase = DOCUMENT_PHASE.SUBMISSION) {
  const flowType = request.flowType || FLOW_TYPE.A1;
  const nature = canonicalNature(request.expenseNature);
  if (flowType === FLOW_TYPE.B) return phase === DOCUMENT_PHASE.SUBMISSION
    ? [requirement("XML", "invoice XML"), requirement("PDF", "invoice PDF")] : [];
  if (flowType === FLOW_TYPE.A2) return phase === DOCUMENT_PHASE.INVOICE_REGISTRATION
    ? [requirement("XML", "invoice XML"), requirement("PDF", "invoice PDF")] : [];
  // An undocumented reimbursement (REEMBOLSO_SIN_SUSTENTO) is, by definition, backed by
  // the signed declaration rather than receipts, so no default rendition file is required.
  if (flowType === FLOW_TYPE.C) return phase === DOCUMENT_PHASE.RENDITION && canonicalType(request.requestType) !== "REEMBOLSO_SIN_SUSTENTO"
    ? [requirement("RENDITION", "rendition supporting documents")] : [];
  if (nature === EXPENSE_NATURE.PROFESSIONAL_FEES) {
    if (phase === DOCUMENT_PHASE.SUBMISSION) return [requirement("CONTRACT", "contract or service agreement")];
    if (phase === DOCUMENT_PHASE.INVOICE_REGISTRATION) return [requirement("XML", "electronic fee receipt XML"), requirement("FEE_RECEIPT", "Recibo por Honorarios")];
    if (phase === DOCUMENT_PHASE.ACCOUNTING) return [requirement("ACTIVITY_REPORT", "activity report")];
    return [];
  }
  if (goodsNatures.has(nature)) {
    if (phase === DOCUMENT_PHASE.SUBMISSION) return [requirement("QUOTATION", "at least one quotation", QUOTATION_MINIMUM_COUNT)];
    if (phase === DOCUMENT_PHASE.INVOICE_REGISTRATION) return [requirement("XML", "invoice XML"), requirement("PDF", "invoice PDF")];
    if (phase === DOCUMENT_PHASE.ACCOUNTING) return [requirement("CONFORMITY", "goods conformity or reception evidence")];
    return [];
  }
  if (phase === DOCUMENT_PHASE.SUBMISSION) return [requirement("CONTRACT", "service or contract documentation")];
  if (phase === DOCUMENT_PHASE.INVOICE_REGISTRATION) return [requirement("XML", "invoice XML"), requirement("PDF", "invoice PDF")];
  if (phase === DOCUMENT_PHASE.ACCOUNTING) return [requirement("CONFORMITY", "service conformity")];
  return [];
}

function ruleQuery(request, phase) {
  const requestType = canonicalType(request.requestType);
  const expenseNature = canonicalNature(request.expenseNature);
  const flowType = request.flowType || FLOW_TYPE.A1;
  const phaseMatch = phase === DOCUMENT_PHASE.SUBMISSION
    ? { $or: [{ phase }, { phase: { $exists: false } }] }
    : { phase };
  return {
    active: true,
    requestType: { $in: ["*", requestType] },
    expenseNature: { $in: ["*", expenseNature] },
    $and: [
      { $or: [{ flowType: { $in: ["*", flowType] } }, { flowType: { $exists: false } }] },
      phaseMatch
    ]
  };
}

async function matchingRules(request, phase) {
  return DocumentRule.find(ruleQuery(request, phase)).sort({ flowType: 1, requestType: 1, expenseNature: 1 });
}

export async function configuredDocumentRequirements(request, phase = DOCUMENT_PHASE.SUBMISSION) {
  const rules = await matchingRules(request, phase);
  if (!rules.length) return mergeRequirements(defaultDocumentRequirements(request, phase));
  return mergeRequirements(rules.flatMap((rule) => rule.requirements || []));
}

export async function documentRequirementsByPhase(request) {
  const entries = await Promise.all(DOCUMENT_PHASES.map(async phase => [phase, await configuredDocumentRequirements(request, phase)]));
  return Object.fromEntries(entries);
}

export function currentDocumentPhase(request) {
  if (request.flowType === FLOW_TYPE.C) return request.rendition?.status && request.rendition.status !== "NOT_REQUIRED" ? DOCUMENT_PHASE.RENDITION : DOCUMENT_PHASE.SUBMISSION;
  if (request.flowType === FLOW_TYPE.A2) return DOCUMENT_PHASE.INVOICE_REGISTRATION;
  if (request.accountsPayable || request.accountsPayables?.length) return DOCUMENT_PHASE.ACCOUNTING;
  if (request.purchaseOrder) return DOCUMENT_PHASE.INVOICE_REGISTRATION;
  if (["APROBADO_VICERRECTOR", "COMPROMISO_PRESUPUESTAL"].includes(request.status)) return DOCUMENT_PHASE.PROCUREMENT;
  return DOCUMENT_PHASE.SUBMISSION;
}

export async function documentStatusByPhase(request) {
  const requirements = await documentRequirementsByPhase(request);
  const phases = Object.fromEntries(DOCUMENT_PHASES.map(phase => [phase, validateDocumentRequirements(request, requirements[phase])]));
  return { currentPhase: currentDocumentPhase(request), phases };
}

export function defaultQuotationPolicy(request) {
  const quotation = defaultDocumentRequirements(request, DOCUMENT_PHASE.SUBMISSION).find((item) => item.kind === "QUOTATION");
  return { enabled: Boolean(quotation), minimumCount: QUOTATION_MINIMUM_COUNT, source: "DEFAULT_DOCUMENT_REQUIREMENTS" };
}

export async function configuredQuotationPolicy(request) {
  const rules = await matchingRules(request, DOCUMENT_PHASE.SUBMISSION);
  if (!rules.length) return defaultQuotationPolicy(request);
  const quotationRequired = rules.some((rule) => rule.quotationPolicy?.enabled || (rule.requirements || []).some((item) => item.kind === "QUOTATION"));
  if (!quotationRequired) return { ...defaultQuotationPolicy(request), source: "CONFIGURED_DOCUMENT_RULES", ruleCodes: rules.map((rule) => rule.code) };
  return { enabled: true, minimumCount: QUOTATION_MINIMUM_COUNT, source: "CONFIGURED_DOCUMENT_RULES", ruleCodes: rules.map((rule) => rule.code) };
}

// With a minimum of one quotation there is nothing left to waive, so the former authorized
// "single-source exception" (request.quotationException) no longer participates in validation.
export function validateStructuredQuotationComparison(request, policy = defaultQuotationPolicy(request)) {
  const paymentErrors = (request.quotations || []).flatMap((quotation, index) => validatePaymentTerms(quotation).map((error) => ({ code: "QUOTATION_PAYMENT_TERMS_INVALID", quotation: index + 1, ...error })));
  if (!policy.enabled) return { valid: paymentErrors.length === 0, applicable: false, policy, errors: paymentErrors };
  const quotations = request.quotations || [];
  const errors = [...paymentErrors];
  const supplierIds = new Set(quotations.map((quotation) => String(quotation.supplier?._id || quotation.supplier || "")).filter(Boolean));
  if (supplierIds.size < QUOTATION_MINIMUM_COUNT) errors.push({ code: "QUOTATION_MINIMUM_NOT_MET", required: QUOTATION_MINIMUM_COUNT, present: supplierIds.size });
  if (quotations.some((quotation) => !quotation.supplier)) errors.push({ code: "QUOTATION_SUPPLIER_REQUIRED" });
  quotations.forEach((quotation, index) => { if (!quotation.attachment) errors.push({ code: "QUOTATION_ATTACHMENT_REQUIRED", quotation: index + 1 }); });
  const recommended = quotations.filter((quotation) => quotation.recommended);
  if (recommended.length === 0) errors.push({ code: "NO_RECOMMENDED_QUOTATION", present: 0 });
  if (recommended.length > 1) errors.push({ code: "MULTIPLE_RECOMMENDED_QUOTATIONS", present: recommended.length });
  const selectedSupplier = String(request.supplier?._id || request.supplier || "");
  if (recommended.length === 1 && String(recommended[0].supplier?._id || recommended[0].supplier || "") !== selectedSupplier) errors.push({ code: "RECOMMENDED_SUPPLIER_MISMATCH" });
  if (!String(request.supplierSelectionReason || "").trim()) errors.push({ code: "SUPPLIER_SELECTION_REASON_REQUIRED" });
  return { valid: errors.length === 0, applicable: true, policy: { ...policy, minimumCount: QUOTATION_MINIMUM_COUNT }, errors };
}

export function validateDocumentRequirements(request, requirements, attachments = request.attachments || []) {
  const counts = attachments.reduce((map, attachment) => { map.set(attachment.kind, (map.get(attachment.kind) || 0) + 1); return map; }, new Map());
  const evaluated = requirements.map((item) => ({ ...item, present: counts.get(item.kind) || 0 }));
  const missing = evaluated.filter((item) => item.present < item.minCount).map((item) => ({ kind: item.kind, required: item.minCount, present: item.present, label: item.labelKey }));
  return { valid: missing.length === 0, requirements: evaluated, missing };
}

export function assertDocumentRequirements(request, requirements, phase, attachments = request.attachments || []) {
  const result = validateDocumentRequirements(request, requirements, attachments);
  if (!result.valid) throw new AppError(422, `Mandatory evidence is missing for ${phase}.`, { phase, missing: result.missing, requirements: result.requirements }, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
  return { ...result, phase };
}

export async function assertConfiguredDocuments(request, phase = DOCUMENT_PHASE.SUBMISSION, attachments = request.attachments || []) {
  return assertDocumentRequirements(request, await configuredDocumentRequirements(request, phase), phase, attachments);
}
