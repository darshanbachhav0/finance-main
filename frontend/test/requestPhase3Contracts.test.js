import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test("RCO-FOR-001 extends the existing request wizard instead of introducing a parallel request page", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /export default function RequestCreate/);
  assert.doesNotMatch(page, /FinancialRequestV2|OfficialRequest|CAPEXRequest|OPEXRequest/);
  // One wizard in four steps: supplier, receipt, details, summary.
  for (const section of ["Supplier details", "Receipt and automation", "Requirement details", "Summary and submit", "BudgetRemainingSummary", "<RequestReview "]) {
    assert.ok(page.includes(section), `Missing ${section}`);
  }
});

test("Solicitor CECO choices come from the authorized backend endpoint and lines inherit the header", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /requests\/authorized-cost-centers/);
  assert.match(page, /setHeaderCostCenter/);
  assert.match(page, /costCenter: !line\.costCenter \|\| line\.costCenter === previous/);
  assert.doesNotMatch(page, /api\.get\("\/cost-centers"/);
});

test("CAPEX and OPEX conditional sections use the approved enums and server project snapshot identifier", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /form\.requestType === "CAPEX"/);
  // OPEX keeps its frequency in step with the request's own frequency.
  assert.match(page, /opexDetails", JSON\.stringify\(form\.requestType === "OPEX" \? \{ expenseFrequency: form\.frequency \}/);
  for (const value of ["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES"]) assert.ok(page.includes(value));
  assert.match(source("../src/utils/options.js"), /requestFrequencies = \["ONE_OFF", "MONTHLY_RECURRING", "EVERY_3_MONTHS", "ANNUAL_RENEWAL"\]/);
  assert.match(page, /projectSnapshot: \{ id: capex\.projectId/);
  assert.doesNotMatch(page, /projectSnapshot: \{[^}]*name:/);
});

test("structured quotation comparison links one evidence file per supplier and one radio recommendation", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  // The first quotation is the chosen supplier's and is the recommended one; others compare.
  assert.match(page, /recommended: Boolean\(form\.supplier\)/);
  assert.match(page, /data\.append\("quotation", file\)/);
  assert.match(page, /\["REJECTED", "INACTIVE"\]/);
  // The supplier is required to save the request at all (Save draft too), not only to submit it.
  assert.match(page, /next\.supplier = "Select the supplier or register a new one\."/);
  assert.match(page, /: \["supplier", "details"\];/, "a saved draft checks the supplier and the details");
});

test("budget preview uses the backend service endpoint and sends no client-owned budget decision", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /requests\/budget-preview/);
  assert.doesNotMatch(page, /budgetStatus:/);
  assert.doesNotMatch(page, /budgetCommitment:/);
  assert.match(source("../src/components/BudgetRemainingSummary.jsx"), /No funds are reserved here/);
});

test("Request Detail exposes approver-visible official fields, quotations, supplier status, and budget preview", () => {
  const page = source("../src/pages/RequestDetail.jsx");
  for (const section of ["Requirement and justification", "CAPEX financial information", "Supplier quotations", "Recommended supplier", "Budget preview", "<RequestSummaryFacts"]) assert.ok(page.includes(section), `Missing ${section}`);
  assert.match(page, /related\.budgetPreview/);
  assert.match(page, /supplier\?\.homologationStatus/);
  assert.match(page, /ProtectedAssetButton/);
});

test("all Phase 3 labels and validation codes participate in the shared English-Spanish dictionary", () => {
  const language = source("../src/context/LanguageContext.jsx");
  assert.match(language, /const phase3RequestSpanish = \{/);
  assert.match(language, /\.\.\.phase3RequestSpanish/);
  for (const key of ["Requirement title", "Business justification", "Supplier quotations", "Supplier selection reason", "Budget preview", "INVALID_COST_CENTER_LINE", "QUOTATION_ATTACHMENT_REQUIRED", "SUPPLIER_REJECTED"]) assert.ok(language.includes(key), `Missing translation ${key}`);
});

test("official request layouts collapse to one column without page-level fixed widths at 390px", () => {
  const styles = source("../src/styles/global.css");
  assert.match(styles, /@media \(max-width: 400px\)/);
  // Item lines and the budget preview tighten on small screens; the earlier form's quotation cards
  // are gone (quotes are file uploads in the receipt step).
  assert.match(styles, /\.official-line, \.budget-preview \{ padding: 11px; \}/);
  assert.match(source("../src/styles/requestWizard.css"), /@media \(max-width: 640px\)/);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} Request Phase 3 contract tests passed.`);
