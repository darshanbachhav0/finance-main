import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
const source = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
test("triple-track domain exposes A1, A2, B and C with canonical exception states", () => {
  const constants = source("../src/utils/constants.js");
  for (const token of ["A1", "A2", "B", "C", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA", "PAGO_REBOTADO", "PAGADO_CERRADO"]) assert.ok(constants.includes(token), `Missing ${token}`);
});
test("invoice-level CXP supports multiple records per request and links PO, SUNAT and batch", () => {
  const model = source("../src/models/AccountsPayable.js");
  assert.match(model, /purchaseOrder/);
  assert.match(model, /sunatVoucher/);
  assert.match(model, /sourceBatch/);
  assert.doesNotMatch(model, /request[^\n]*unique:\s*true/);
});
test("audit log remains append-only", () => {
  const audit = source("../src/models/AuditLog.js");
  assert.match(audit, /append-only/i);
  assert.match(audit, /deleteOne|deleteMany/);
});

test("A1 and B creation only allow CAPEX/OPEX while C stays an advance-to-render", () => {
  const requestService = source("../src/services/requestService.js");
  const frontendOptions = source("../../frontend/src/utils/options.js");
  const requestCreate = source("../../frontend/src/pages/RequestCreate.jsx");

  assert.match(frontendOptions, /requestCreationClassifications = \["OPEX", "CAPEX"\]/);
  assert.match(frontendOptions, /if \(flowType === "C"\) return "ENTREGA_RENDIR"/);
  assert.match(requestService, /Tracks A1 and B only allow CAPEX or OPEX as the expenditure classification\./);
  assert.match(requestCreate, /CAPEX \/ OPEX \*/);
  assert.match(requestCreate, /form\.flowType !== "C"/);
});
