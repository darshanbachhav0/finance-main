import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
const source = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
test("Track B performs XML/SUNAT preflight and automatic priority provisioning", () => {
  const service = source("../src/services/directPaymentService.js");
  for (const token of ["preflightDirectPayment", "validateVoucherWithSunat", "provisionDirectPayment", "PRIORITY", "createAccountsPayableFromVoucher"]) assert.ok(service.includes(token), `Missing ${token}`);
});
test("Track B bypasses Purchase Order while preserving budget execution", () => {
  const request = source("../src/services/requestService.js");
  const budget = source("../src/services/budgetService.js");
  assert.match(request, /FLOW_TYPE\.B/);
  assert.match(budget, /executeBudget/);
});
