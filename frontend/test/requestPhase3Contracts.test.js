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
  for (const section of ["General information", "Item / service breakdown", "Supplier quotations", "Budget preview", "Review and submit"]) {
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
  assert.match(page, /form\.requestType === "OPEX"/);
  for (const value of ["INFRASTRUCTURE", "MACHINERY", "IT_HARDWARE", "SOFTWARE_LICENSES", "ONE_OFF", "MONTHLY_RECURRING", "ANNUAL_RENEWAL"]) assert.ok(page.includes(value));
  assert.match(page, /projectSnapshot: \{ id: capex\.projectId/);
  assert.doesNotMatch(page, /projectSnapshot: \{[^}]*name:/);
});

test("commercial totals are displayed but never submitted as authoritative line values", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /Number\(line\.quantity \|\| 0\) \* Number\(line\.unitPrice \|\| 0\)/);
  assert.doesNotMatch(page, /commercialTotal:/);
  assert.match(page, /commercialTotalStatus|Reconciliation status/);
});

test("structured quotation comparison links one evidence file per supplier and one radio recommendation", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /quotationPolicy\.minimumCount/);
  assert.match(page, /name="recommended-quotation"/);
  assert.match(page, /data\.append\("quotation", file\)/);
  assert.match(page, /Supplier not found\? Open the official supplier proposal flow/);
  assert.match(page, /\["REJECTED", "INACTIVE"\]/);
  assert.match(page, /!quotationPolicy\.enabled && <div className="official-subsection">/);
  assert.match(page, /!quotationPolicy\.enabled && submitting && !form\.supplier/);
  assert.match(page, /current\.some\(quotationHasData\) \? current : \[\]/);
});

test("budget preview uses the backend service endpoint and sends no client-owned budget decision", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  assert.match(page, /requests\/budget-preview/);
  assert.doesNotMatch(page, /budgetStatus:/);
  assert.doesNotMatch(page, /budgetCommitment:/);
  assert.match(page, /No funds are reserved here/);
});

test("Request Detail exposes approver-visible official fields, quotations, supplier status, and budget preview", () => {
  const page = source("../src/pages/RequestDetail.jsx");
  for (const section of ["Requirement and justification", "CAPEX financial information", "OPEX financial information", "Supplier quotations", "Recommended supplier", "Budget preview"]) assert.ok(page.includes(section), `Missing ${section}`);
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
  assert.match(styles, /@media \(max-width: 430px\)/);
  assert.match(styles, /\.quotation-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.official-line, \.quotation-card, \.budget-preview/);
  assert.doesNotMatch(styles, /\.quotation-card[^}]*width:\s*\d+px/);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} Request Phase 3 contract tests passed.`);
