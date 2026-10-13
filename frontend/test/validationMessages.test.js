import assert from "node:assert/strict";
import { validationSummary, apiErrorMessage } from "../src/utils/validationMessages.js";

const summary = validationSummary({ requesterCostCenter: "This field is required.", "lines.1.quantity": "Enter a valid quantity.", "quotations.0.attachment": "Quotation evidence is required." });
assert.match(summary, /Cost Center \/ CECO: This field is required/);
assert.match(summary, /Item 2 — Quantity: Enter a valid quantity/);
assert.match(summary, /Quotation 1 — Quotation evidence/);
const response = details => ({ response: { status: 422, data: { message: "Validation failed.", details } } });
assert.match(apiErrorMessage(response([{ field: "currency", message: "Select a valid currency." }])), /Currency: Select a valid currency/);
assert.match(apiErrorMessage(response({ missing: [{ kind: "XML", required: 1, present: 0 }] })), /XML: required 1, uploaded 0/);
assert.match(apiErrorMessage(response({ errors: [{ field: "cci", message: "CCI must contain 20 digits." }] })), /CCI: CCI must contain 20 digits/);
assert.match(apiErrorMessage(response({ field: "accountingPeriod" })), /Request month/);
assert.match(apiErrorMessage({}), /Check your connection/);
const failure = apiErrorMessage({ response: { status: 500, data: { message: "Internal server error", details: [{ field: "secret", message: "private" }] } } });
assert.match(failure, /contact Administration/);
assert.doesNotMatch(failure, /private|secret/);
const translated = validationSummary({ quantity: "This field is required." }, text => ({ "Please complete or correct:": "Completa o corrige:", Quantity: "Cantidad", "This field is required.": "Campo obligatorio." }[text] || text));
assert.match(translated, /Cantidad: Campo obligatorio/);

// The invoice check names every value that differs from the factura PDF / XML, expected vs found.
const invoiceMismatch = response({ validation: { source: "PDF", errors: ["(English sentences)"], mismatches: [
  { field: "issueDate", expected: "2026-10-12", found: "2026-10-08" },
  { field: "totalAmount", expected: 1190, found: 1180.5 },
  { field: "documentNumber", expected: null, found: null },
  { field: "igvAmount", expected: 180, found: null }
] } });
invoiceMismatch.response.data.message = "The factura PDF does not match the request.";
assert.equal(apiErrorMessage(invoiceMismatch), [
  "The factura PDF does not match the request.",
  "• Issue date: expected 2026-10-12, the factura PDF shows 2026-10-08.",
  "• Total amount: expected 1190.00, the factura PDF shows 1180.50.",
  "• Voucher number: the factura PDF does not show it.",
  "• IGV amount: expected 180.00, but the factura PDF does not show it."
].join("\n"));
const spanish = (await import("../src/context/i18n/feedback.js")).default;
const es = (text) => ({ ...spanish, "Issue date": "Fecha de emisión", "Total amount": "Monto total", "IGV amount": "Monto IGV", "The factura PDF does not match the request.": "El PDF de la factura no coincide con la solicitud." })[text] || text;
const inSpanish = apiErrorMessage(invoiceMismatch, es);
assert.match(inSpanish, /• Fecha de emisión: se esperaba 2026-10-12; el PDF de la factura muestra 2026-10-08\./);
assert.match(inSpanish, /• Número de comprobante: el PDF de la factura no lo muestra\./);
assert.match(apiErrorMessage(response({ validation: { source: "XML", mismatches: [{ field: "supplier", expected: "20512345678", found: "20999999991" }] } })), /Supplier RUC\/DNI: expected 20512345678, the invoice XML shows 20999999991\./);
// Results stored before the structured list existed still show their sentences.
assert.match(apiErrorMessage(response({ validation: { errors: ["Total amount does not match the XML."] } })), /• Total amount does not match the XML\./);
console.log("PASS actionable validation summaries: fields, item numbers, server reasons, missing documents, invoice mismatches, translation and safe server errors");
