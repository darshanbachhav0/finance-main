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
console.log("PASS actionable validation summaries: fields, item numbers, server reasons, missing documents, translation and safe server errors");
