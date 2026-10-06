// The first two steps of the request form hold four blocks ("What and why": need, why;
// "Budget and items": budget, items). Each block owns a set of form
// fields (and item-line fields) so its "Complete" badge follows the same validation rules
// used on Continue / Submit.

export const REQUEST_FORM_BLOCKS = [
  {
    id: "need",
    title: "What do you need?",
    description: "Track, classification and a clear description of the requirement.",
    fields: ["flowType", "requestType", "expenseNature", "title", "detailedDescription", "description", "priority", "areaCorrelative", "schoolOrDepartment"]
  },
  {
    id: "why",
    title: "Why?",
    description: "The business reason and what happens if it is not approved.",
    fields: ["businessJustification", "nonApprovalRisk"]
  },
  {
    id: "budget",
    title: "Budget",
    description: "Where the spend is charged: area, CECO, month and currency.",
    fields: ["requesterCostCenter", "issueDate", "accountingPeriod", "currency"]
  },
  {
    id: "items",
    title: "Items and amounts",
    description: "Enter the quantity and unit price. We calculate IGV and the final total for you.",
    fields: ["lines"],
    // An item's cost center is set in the items block ("Adjust budget allocation").
    linePattern: /^lines\.\d+\.(itemDescription|quantity|unitPrice|unitOfMeasure|totalAmount|costCenter)$/
  }
];

/** Fields collapsed under "More details (optional)": they are optional or have a default. */
export const OPTIONAL_REQUEST_FIELDS = ["priority", "areaCorrelative", "schoolOrDepartment"];

export function blockForField(key) {
  return REQUEST_FORM_BLOCKS.find((block) => block.fields.includes(key) || block.linePattern?.test(key))?.id || "";
}

export function isRequestFormField(key) {
  return Boolean(blockForField(key));
}

/**
 * "complete" when none of the block's fields has a problem, "incomplete" otherwise;
 * a block listed in `optional` with nothing filled in reads "optional".
 */
export function requestBlockStatuses(problems = {}, { optional = [], filled = {} } = {}) {
  const keys = Object.keys(problems).filter((key) => problems[key]);
  return Object.fromEntries(REQUEST_FORM_BLOCKS.map((block) => {
    const pending = keys.filter((key) => blockForField(key) === block.id);
    if (pending.length) return [block.id, "incomplete"];
    if (optional.includes(block.id) && !filled[block.id]) return [block.id, "optional"];
    return [block.id, "complete"];
  }));
}
