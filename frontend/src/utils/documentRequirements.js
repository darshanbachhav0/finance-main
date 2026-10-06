// A document requirement is met by files of one kind, or - the invoice - by any one of several:
// its XML or its factura PDF (backend documentRuleService: { kind: "INVOICE", anyOf: ["XML", "PDF"] }).
// When the XML is there the server verifies it; otherwise it reads the factura PDF.
export const requirementKinds = (rule) => (rule?.anyOf?.length ? rule.anyOf : [rule?.kind]);
export const coversKind = (rule, kind) => requirementKinds(rule).includes(kind);
export const ruleForKind = (rules = [], kind) => rules.find((rule) => coversKind(rule, kind));
export const isEitherOf = (rule) => (rule?.anyOf?.length || 0) > 1;

// Files present for a requirement: stored attachments plus any chosen in the form ({ XML: 1 }).
export function presentCount(rule, attachments = [], chosen = {}) {
  return requirementKinds(rule).reduce((sum, kind) => sum + attachments.filter((item) => item.kind === kind).length + (chosen[kind] || 0), 0);
}
