const labels = {
  requestType: "Request type", expenseNature: "Expense nature", requesterCostCenter: "Cost Center / CECO",
  costCenter: "Cost Center / CECO", expenseType: "Expense type", issueDate: "Issue date",
  accountingPeriod: "Request month", currency: "Currency", priority: "Priority", description: "Description",
  title: "Title", detailedDescription: "Detailed description", businessJustification: "Business justification",
  nonApprovalRisk: "Risk if not approved", supplierSelectionReason: "Supplier selection reason",
  supplier: "Supplier", recommended: "Recommended supplier", itemDescription: "Item / Service Description",
  quantity: "Quantity", unitPrice: "Unit price", unitOfMeasure: "Unit of measure", totalAmount: "Total",
  amount: "Amount", attachment: "Quotation evidence", rucDni: "RUC / identifier", personType: "Person type",
  accountType: "Account type", accountNumber: "Account number", cci: "CCI", dni: "DNI", email: "Email",
  name: "Name", bank: "Bank", lines: "Items", quotations: "Quotations"
};
export function validationFieldLabel(path, t = value => value) {
  const parts = String(path || "").split(".");
  const key = parts.at(-1);
  const label = t(labels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "));
  if (["lines", "quotations"].includes(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${t(parts[0] === "lines" ? "Item" : "Quotation")} ${Number(parts[1]) + 1} — ${label}`;
  }
  return label;
}
export function validationSummary(errors, t = value => value) {
  return [t("Please complete or correct:"), ...Object.entries(errors).map(([field, reason]) =>
    `• ${validationFieldLabel(field, t)}: ${t(reason)}`)].join("\n");
}
// Invoice check (backend xmlValidationService): each difference between the request and the
// invoice file, as { field, expected, found }; found is null when the file does not show it.
const invoiceFieldLabels = {
  supplier: "Supplier RUC/DNI", currency: "Currency", documentNumber: "Voucher number", issueDate: "Issue date",
  netAmount: "Net amount", igvAmount: "IGV amount", totalAmount: "Total amount"
};
const invoiceAmountFields = new Set(["netAmount", "igvAmount", "totalAmount"]);
const fill = (template, params) => template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));

function invoiceValue(field, value) {
  if (value === null || value === undefined || value === "") return "";
  if (invoiceAmountFields.has(field) && Number.isFinite(Number(value))) return Number(value).toFixed(2);
  if (field === "issueDate") return String(value).slice(0, 10);
  return String(value);
}

export function invoiceMismatchLines(validation, t = value => value) {
  const mismatches = Array.isArray(validation?.mismatches) ? validation.mismatches : [];
  // Results stored before mismatches existed only carry English sentences.
  if (!mismatches.length) return (Array.isArray(validation?.errors) ? validation.errors : []).map((text) => t(text));
  const document = t(validation.source === "PDF" ? "factura PDF" : "invoice XML");
  return mismatches.map(({ field, expected, found }) => {
    const params = { field: t(invoiceFieldLabels[field] || field), expected: invoiceValue(field, expected), found: invoiceValue(field, found), document };
    if (params.found) return fill(t("{field}: expected {expected}, the {document} shows {found}."), params);
    return fill(params.expected ? t("{field}: expected {expected}, but the {document} does not show it.") : t("{field}: the {document} does not show it."), params);
  });
}

export function apiErrorMessage(error, t = value => value) {
  const body = error.response?.data;
  if (!error.response) return t("Could not connect to the server. Check your connection and try again.");
  const message = body?.message || (error.response.status >= 500
    ? "The server could not complete this action. Try again; if it continues, contact Administration."
    : "The action could not be completed. Check the information and try again.");
  const details = body?.details;
  if (error.response.status >= 500) return t(message === "Internal server error"
    ? "The server could not complete this action. Try again; if it continues, contact Administration." : message);
  const entries = Array.isArray(details) ? details : Array.isArray(details?.errors) ? details.errors : [];
  const issues = entries.map(item => {
    if (typeof item === "string") return t(item);
    return [validationFieldLabel(item.field || item.path || item.label || "", t), t(item.message || item.reason || "Check this field.")].filter(Boolean).join(": ");
  });
  for (const item of Array.isArray(details?.missing) ? details.missing : []) {
    if (typeof item === "string") issues.push(`${validationFieldLabel(item, t)}: ${t("This field is required.")}`);
    else issues.push(`${t(item.label || item.kind || item.field || "Document")}: ${t("required")} ${item.required ?? item.minCount ?? 1}, ${t("uploaded")} ${item.present ?? 0}`);
  }
  if (Array.isArray(details?.required)) for (const field of details.required) issues.push(`${validationFieldLabel(field, t)}: ${t("This field is required.")}`);
  // The invoice XML or factura PDF does not match: say which values differ, not only that they do.
  if (details?.validation) issues.push(...invoiceMismatchLines(details.validation, t));
  if (details?.field && !issues.length) issues.push(validationFieldLabel(details.field, t));
  return [t(message), ...[...new Set(issues)].map(issue => `• ${issue}`)].join("\n");
}
