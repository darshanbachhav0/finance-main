import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

test("RCO-FOR-002 supplier workspace uses the existing shared UI and all official sections", () => {
  const page = source("../src/pages/Suppliers.jsx");
  const form = source("../src/components/suppliers/SupplierForm.jsx");
  const detail = source("../src/components/suppliers/SupplierDetail.jsx");
  assert.doesNotMatch(page, /ResourceManager/);
  for (const component of ["DataTable", "Drawer", "ConfirmDialog", "StatusBadge", "usePaginatedResource"]) assert.ok(page.includes(component));
  for (const section of [
    "Legal Identification",
    "Commercial Contact",
    "Operations / Logistics Contact",
    "Commercial Conditions",
    "Bank accounts"
  ]) assert.ok(form.includes(section), `Missing form section ${section}`);
  // The declarations and the three "mandatory" documents were taken out of the proposal form.
  for (const removed of ["Compliance Declarations", "Mandatory Documents", "Needed for homologation", "DeclarationField"]) assert.ok(!form.includes(removed), `Removed from the form: ${removed}`);
  for (const section of ["Banking Information", "Areas", "Provider review", "ERP Supplier Code", "Audit / History", "Homologation Readiness"]) {
    assert.ok(detail.includes(section), `Missing detail section ${section}`);
  }
});

test("supplier UI calls the staged backend actions and never posts Finance-owned fields from proposal forms", () => {
  const page = source("../src/pages/Suppliers.jsx");
  const form = source("../src/components/suppliers/SupplierForm.jsx");
  for (const contract of [
    "/lookup/",
    "/proposal",
    "/bank-accounts",
    "/taxpayer-validation",
    "/approval",
    "/homologation-readiness"
  ]) assert.ok(page.includes(contract), `Missing API contract ${contract}`);
  // Accounting no longer reviews or homologates: only the proposer's jefe decides.
  for (const retired of ["/review`", "/homologate`"]) assert.ok(!page.includes(retired), `Retired API contract ${retired}`);
  for (const protectedField of ["supplierCode", "complianceReview", "homologationStatus", "verificationStatus", "ownershipResult", "verifiedBy", "verifiedAt"]) {
    assert.doesNotMatch(form, new RegExp(`append\\(\\"${protectedField}\\"`), `Proposal form must not submit ${protectedField}`);
  }
});

test("the proposer's jefe decides suppliers from the record and from the Approval Inbox", () => {
  const detail = source("../src/components/suppliers/SupplierDetail.jsx");
  const inbox = source("../src/pages/ApprovalInbox.jsx");
  assert.ok(detail.includes("permissions.canApprove"));
  for (const decision of ["APPROVE", "OBSERVE", "REJECT"]) assert.ok(detail.includes(`onDecision("${decision}")`));
  assert.doesNotMatch(inbox, /SupplierApprovalDecisions|supplierDecisions/);
  assert.ok(detail.includes('title="Provider review"'));

});

test("all Phase 2 Supplier labels have one synchronized Spanish dictionary", () => {
  const language = source("../src/context/LanguageContext.jsx");
  assert.match(language, /const phase2SupplierSpanish = \{/);
  assert.match(language, /\.\.\.phase2SupplierSpanish/);
  for (const label of [
    "Supplier Master & Homologation",
    "Legal Identification",
    "Banking Information",
    "Compliance Declarations",
    "Jefe Approval",
    "Homologation Readiness",
    "Approve supplier",
    "LEGACY_ACCEPTED",
    "MANUAL_ACCEPTED"
  ]) assert.ok(language.includes(`\"${label}\"`) || language.includes(`${label}:`), `Missing Spanish key ${label}`);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} Supplier Phase 2 contract tests passed.`);
