import assert from "node:assert/strict";
import { roleNavigation, canAccessNavigation } from "../src/utils/navigationAccess.js";
import { requestStage } from "../src/utils/requestStage.js";
import { displayedRequestStatus } from "../src/utils/requestPresentation.js";
for (const [role, items] of Object.entries(roleNavigation)) {
  assert.ok(items.length <= 5, `${role}: primary menu stays focused`);
  assert.equal(new Set(items.map(([, path]) => path)).size, items.length);
  items.forEach(([, path]) => assert.ok(canAccessNavigation(role, path), `${role}: ${path}`));
}
assert.deepEqual(roleNavigation.Admin.map(([, path]) => path), ["/", "/administration"]);
assert.deepEqual(roleNavigation.Treasury.map(([, path]) => path), ["/", "/treasury", "/treasury/history"]);
assert.equal(canAccessNavigation("Solicitor", "/suppliers"), true, "Contextual supplier workflow remains accessible");
assert.equal(canAccessNavigation("Solicitor", "/administration"), false);
assert.equal(requestStage("TXT_GENERADO"), 4, "TXT generation does not complete Payment");
assert.equal(requestStage("PAGADO"), 5, "Paid still awaits reconciliation");
assert.equal(requestStage("PAGADO_CERRADO"), requestStage("CERRADO"));
for (const status of ["RECHAZADO", "ANULADO", "UNKNOWN"]) assert.equal(requestStage(status), -1, "No fabricated completed stages for interruptions");
assert.equal(requestStage(displayedRequestStatus({ status: "PAGADO", financialProgress: { status: "TXT_GENERADO", counts: { total: 3, paid: 1 }, partialPayment: true } })), 4);
console.log("PASS focused role menus, secondary access, canonical stages, partial payment and terminal safety");
