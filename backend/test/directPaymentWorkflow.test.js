import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
const source = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
test("Process B keeps invoice verification but moves provisioning to Accounting", () => {
  const service = source("../src/services/directPaymentService.js");
  const approval = source("../src/services/approvalService.js");
  const registration = source("../src/services/directInvoiceService.js");
  assert.match(service, /preflightDirectPayment/);
  assert.match(service, /validateVoucherWithSunat/);
  assert.match(service, /provisionDirectPayment\(\)\s*\{\s*throw/);
  assert.doesNotMatch(approval, /await provisionDirectPayment\(/);
  assert.doesNotMatch(registration, /await provisionDirectPayment\(/);
  assert.match(registration, /accountingReviewRequired: true/);
  assert.match(approval, /roles: \[ROLES\.ACCOUNTING\]/);
});
test("Process B preserves quotation-first documents, PO exemption and budget reservation", () => {
  const request = source("../src/services/requestService.js");
  const budget = source("../src/services/approvalService.js");
  const docs = source("../src/services/documentRuleService.js");
  assert.match(request, /FLOW_TYPE\.B/);
  assert.match(docs, /FLOW_TYPE\.B/);
  assert.match(budget, /reserveBudget\(request/);
  assert.match(budget, /direct-invoice-needed/);
});
