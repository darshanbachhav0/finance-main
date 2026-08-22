import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test("Request Detail reuses one official rendition workspace for both approved request types", () => {
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(detail, /OfficialRenditionWorkspace/);
  assert.match(detail, /\["ENTREGA_RENDIR", "REEMBOLSO_SIN_SUSTENTO"\]/);
  assert.doesNotMatch(detail, /OfficialRenditionV2|ExpenseReimbursementV2/);
});

test("official workspace includes every Phase 4 information and review section", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  for (const section of ["Employee Information", "Local Transportation", "Expenses Without Supporting Documents", "Reimbursement Banking", "Accounting Allocation", "Totals / Reconciliation", "Exceptional Use Declaration", "Beneficiary Acknowledgment", "Finance Review"]) {
    assert.ok(workspace.includes(section), `Missing ${section}`);
  }
});

test("mobility and unsupported rows are repeatable and use semantic form controls", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  assert.match(workspace, /setMobilityLines\(\(rows\) => \[\.\.\.rows, emptyMobility\(\)\]\)/);
  assert.match(workspace, /setUnsupportedLines\(\(rows\) => \[\.\.\.rows, emptyUnsupported\(\)\]\)/);
  assert.match(workspace, /type="date"/);
  assert.match(workspace, /goodsServiceType/);
});

test("daily mobility warning comes from the backend policy and is not hard-coded in JSX", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  assert.match(workspace, /rendition\/policy/);
  assert.match(workspace, /policy\.mobility\.numericValue/);
  assert.doesNotMatch(workspace, /\b41\b/);
  assert.match(workspace, /Submission is not automatically rejected/);
});

test("browser totals are previews while the server receives only source detail lines", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  assert.match(workspace, /mobilityLines", JSON\.stringify/);
  assert.match(workspace, /unsupportedExpenseLines", JSON\.stringify/);
  assert.doesNotMatch(workspace, /data\.append\("mobilitySubtotal"/);
  assert.doesNotMatch(workspace, /data\.append\("reimbursementTotal"/);
  assert.match(workspace, /detailReconciliation/);
});

test("authenticated acknowledgment and exceptional declaration have explicit controls", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  assert.match(workspace, /beneficiaryAcknowledged/);
  assert.match(workspace, /confirmedExceptionalUse/);
  assert.match(workspace, /Authenticated electronic acknowledgment/);
  assert.match(workspace, /!acknowledged/);
});

test("employee reimbursement banking is a protected role-aware route", () => {
  const app = source("../src/App.jsx");
  const access = source("../src/utils/navigationAccess.js");
  assert.match(app, /path="reimbursement-bank"/);
  assert.match(app, /roles=\{\["Admin", "Solicitor", "Accounting", "Treasury"\]\}/);
  assert.match(access, /"\/reimbursement-bank": \["Admin", "Solicitor", "Accounting", "Treasury"\]/);
});

test("bank UI masks values, separates Finance review, and exposes no verification field in employee form", () => {
  const page = source("../src/pages/EmployeeReimbursementBanking.jsx");
  assert.match(page, /accountNumberMasked/);
  assert.match(page, /cciMasked/);
  assert.match(page, /canReview = \["Admin", "Accounting"\]/);
  assert.match(page, /result: confirm\.action/);
  assert.doesNotMatch(page, /name="verificationStatus"/);
});

test("Finance review supports approved, observed, and rejected outcomes with comments", () => {
  const workspace = source("../src/components/rendition/OfficialRenditionWorkspace.jsx");
  for (const action of ["approve", "observe", "reject"]) assert.match(workspace, new RegExp(`action: "${action}"`));
  assert.match(workspace, /inputRequired: true/);
  assert.match(workspace, /financeReview\?\.result/);
});

test("Phase 4 layouts collapse safely for 390px-class mobile screens", () => {
  const styles = source("../src/styles/global.css");
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /\.rendition-identity, \.rendition-totals, \.finance-review-row, \.rendition-submit-bar, \.bank-selector-row \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /min-height: 44px/);
  assert.doesNotMatch(styles, /\.official-rendition-workspace[^}]*width:\s*\d+px/);
});

test("all Phase 4 labels and validation codes participate in shared English-Spanish i18n", () => {
  const language = source("../src/context/LanguageContext.jsx");
  assert.match(language, /const phase4RenditionSpanish = \{/);
  assert.match(language, /\.\.\.phase4RenditionSpanish/);
  for (const label of ["Expense Rendition", "Local Transportation", "Exceptional Use Declaration", "Employee Reimbursement Banking", "RENDITION_TOTAL_MISMATCH", "REIMBURSEMENT_BANK_REQUIRED"]) assert.ok(language.includes(label), `Missing ${label}`);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} Rendition Phase 4 contract tests passed.`);
