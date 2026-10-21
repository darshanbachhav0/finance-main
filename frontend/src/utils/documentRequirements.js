// A document requirement is met by files of one kind, or - the invoice - by any one of several:
// its XML or its factura PDF (backend documentRuleService: { kind: "INVOICE", anyOf: ["XML", "PDF"] }).
// When the XML is there the server verifies it; otherwise it reads the factura PDF.
export const requirementKinds = (rule) => (rule?.anyOf?.length ? rule.anyOf : [rule?.kind]);
export const coversKind = (rule, kind) => requirementKinds(rule).includes(kind);
export const ruleForKind = (rules = [], kind) => rules.find((rule) => coversKind(rule, kind));
export const isEitherOf = (rule) => (rule?.anyOf?.length || 0) > 1;
// At submission the requester uploads at least one document, never all of them: the checklist is
// one requirement any uploaded file satisfies (backend documentRuleService.SUBMISSION_DOCUMENT).
export const isAnyDocument = (rule) => rule?.kind === "SUBMISSION_DOCUMENT";

// Files present for a requirement: stored attachments plus any chosen in the form ({ XML: 1 }).
export function presentCount(rule, attachments = [], chosen = {}) {
  return requirementKinds(rule).reduce((sum, kind) => sum + attachments.filter((item) => item.kind === kind).length + (chosen[kind] || 0), 0);
}

// A1 and B: a quote or the invoice, at least one (backend documentRuleService.QUOTE_OR_INVOICE).
// Quotations count through their own cards, the invoice through its XML / factura PDF.
export const isQuoteOrInvoice = (rule) => rule?.kind === "QUOTE_OR_INVOICE";

// The documents a configured submission rule asks for besides the quote or the invoice (which the
// "Comprobante" step collects): each one gets its own upload. "At least one supporting document"
// is offered as one upload of any file.
export function extraSubmissionDocuments(requirements = [], definitions = [], { invoiceAttached = false, flowType } = {}) {
  return requirements
    .filter((rule) => rule.kind !== "QUOTATION" && !isQuoteOrInvoice(rule))
    .filter((rule) => !(flowType === "B" && invoiceAttached && ["XML", "PDF"].some((kind) => coversKind(rule, kind))))
    .map((rule) => ({ rule, definition: isAnyDocument(rule) ? definitions.find((item) => item.kind === "SUPPORTING") : definitions.find((item) => coversKind(rule, item.kind)) }))
    .filter((item) => item.definition);
}
