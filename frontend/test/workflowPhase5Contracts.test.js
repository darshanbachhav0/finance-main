import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test("Request Detail presents one derived procurement readiness summary", () => {
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(detail, /related\.procurementReadiness/);
  assert.match(detail, /Procurement Readiness/);
  assert.match(detail, /Request approval/);
  assert.match(detail, /Budget commitment/);
  assert.match(detail, /Supplier homologation/);
  assert.doesNotMatch(detail, /WorkflowV2|ProcurementWorkflow/);
});

test("supplier readiness exposes pending, observed, rejected, inactive, and PRV outcomes", () => {
  const language = source("../src/context/LanguageContext.jsx");
  for (const code of ["SUPPLIER_HOMOLOGATION_PENDING", "SUPPLIER_HOMOLOGATION_OBSERVED", "SUPPLIER_REJECTED", "SUPPLIER_INACTIVE", "SUPPLIER_PRV_MISSING"]) {
    assert.ok(language.includes(code), `Missing ${code}`);
  }
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(detail, /PRV status/);
  assert.match(detail, /procurementReadiness\.issues/);
});

test("Purchase or Service Order action is status-aware and restricted to Admin or Budget in the UI", () => {
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(detail, /readyForOrderCreation/);
  assert.match(detail, /\["Admin", "Budget"\]\.includes\(user\.role\)/);
  assert.match(detail, /api\.post\(`\/requests\/\$\{id\}\/procurement-order`\)/);
  assert.match(detail, /Purchase Order/);
  assert.match(detail, /Service Order/);
});

test("order confirmation explains immutable supplier, PRV, lines, currency, and amount source", () => {
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(detail, /approved request supplier, PRV, lines, currency, and amount/);
  assert.match(detail, /immutable OC reference and approved-data snapshot/);
  assert.match(detail, /supplierCodeSnapshot/);
});

test("AP screens display the captured supplier payment terms and preserve due date", () => {
  const payable = source("../src/pages/AccountsPayable.jsx");
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.match(payable, /paymentTermsSnapshot/);
  assert.match(payable, /Payment Terms/);
  assert.match(payable, /dueDate/);
  assert.match(detail, /paymentTermsSnapshot/);
  assert.match(detail, /Due date/);
});

test("Treasury sends an explicit account selection while the server supplies the eligible set", () => {
  const treasury = source("../src/pages/TreasuryQueue.jsx");
  assert.match(treasury, /eligibleBankAccounts/);
  assert.match(treasury, /accountSelections/);
  assert.match(treasury, /bank-file.*accountSelections/s);
  assert.match(treasury, /Only verified eligible current accounts are listed/);
  assert.doesNotMatch(treasury, /verificationStatus\s*=/);
});

test("preferred, alternate, blocked, and immutable payment destinations are distinguishable", () => {
  const treasury = source("../src/pages/TreasuryQueue.jsx");
  assert.match(treasury, /Preferred account/);
  assert.match(treasury, /<select/);
  assert.match(treasury, /No eligible matching account/);
  assert.match(treasury, /destinationLocked/);
  assert.match(treasury, /Payment destination snapshot/);
});

test("employee reimbursement destination is locked and never exposed as a selectable Supplier account", () => {
  const treasury = source("../src/pages/TreasuryQueue.jsx");
  assert.match(treasury, /sourceType === "EMPLOYEE_REIMBURSEMENT"/);
  assert.match(treasury, /return row\.paymentDestination\.bank/);
  assert.match(treasury, /destinationLocked \|\| row\.paymentDestination/);
});

test("Phase 5 English and Spanish labels share the existing i18n dictionary", () => {
  const language = source("../src/context/LanguageContext.jsx");
  assert.match(language, /const phase5WorkflowSpanish = \{/);
  assert.match(language, /\.\.\.phase5WorkflowSpanish/);
  for (const label of ["Procurement Readiness", "Purchase Order", "Service Order", "Payment Terms", "Preferred account", "Treasury Account Selection", "Payment Destination Snapshot", "BANK_ACCOUNT_NOT_ELIGIBLE"]) {
    assert.ok(language.includes(label), `Missing ${label}`);
  }
});

test("Phase 5 workflow panels use dense shared styles and collapse at mobile width", () => {
  const styles = source("../src/styles/global.css");
  for (const selector of [".readiness-gates", ".responsibility-map", ".readiness-issues", ".order-summary", ".payment-destination-summary", ".table-account-select"]) {
    assert.ok(styles.includes(selector), `Missing ${selector}`);
  }
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.readiness-gates, \.responsibility-map \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(styles, /\.procurement-readiness[^}]*width:\s*\d+px/);
});

test("Phase 5 does not introduce official PDF or Excel export behavior", () => {
  const detail = source("../src/pages/RequestDetail.jsx");
  assert.doesNotMatch(detail, /RCO-FOR-001.*(?:PDF|Excel)|RCO-FOR-002.*(?:PDF|Excel)/s);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} Phase 5 workflow contract tests passed.`);
