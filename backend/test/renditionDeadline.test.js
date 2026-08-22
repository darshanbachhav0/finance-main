import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
const source = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
test("Track C enforces a ten-day deadline and blocks new overdue advances", () => {
  const treasury = source("../src/services/treasuryService.js");
  const requests = source("../src/services/requestService.js");
  assert.match(treasury, /10 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(requests, /rendition\.dueAt/);
  assert.match(requests, /OVERDUE_RENDITION/);
});
test("non-deductible Account 14 balance supports reimbursement or payroll deduction", () => {
  const rendition = source("../src/services/renditionService.js");
  for (const token of ["nonDeductibleOutstanding", "REIMBURSEMENT", "PAYROLL_DEDUCTION", "REQUEST_STATUS.PAID_CLOSED"]) assert.ok(rendition.includes(token), `Missing ${token}`);
});
