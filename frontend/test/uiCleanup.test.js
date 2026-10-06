import assert from "node:assert/strict";
import { roleNavigation, canAccessNavigation } from "../src/utils/navigationAccess.js";
import { requestStage } from "../src/utils/requestStage.js";
import { displayedRequestStatus } from "../src/utils/requestPresentation.js";
for (const [role, items] of Object.entries(roleNavigation)) {
  // Admin runs the whole system from the grouped menu; Accounting's daily work spans invoices,
  // payables, entries, periods and SIRE. Everyone else keeps a short list.
  if (role !== "Admin") assert.ok(items.length <= (role === "Accounting" ? 8 : 5), `${role}: primary menu stays focused`);
  assert.equal(new Set(items.map(([, path]) => path)).size, items.length);
  items.forEach(([, path]) => assert.ok(canAccessNavigation(role, path), `${role}: ${path}`));
}
assert.ok(roleNavigation.Admin.some(([, path]) => path === "/accounting/payables"), "Admin opens workspaces from the menu, not from a hub page");
assert.deepEqual(roleNavigation.Treasury.map(([, path]) => path), ["/", "/treasury", "/treasury/history", "/operations"]);
assert.equal(canAccessNavigation("Solicitor", "/suppliers"), true, "Contextual supplier workflow remains accessible");
assert.equal(canAccessNavigation("Solicitor", "/settings"), false);
assert.equal(requestStage("TXT_GENERADO"), 4, "TXT generation does not complete Payment");
assert.equal(requestStage("PAGADO"), 5, "Paid still awaits reconciliation");
assert.equal(requestStage("PAGADO_CERRADO"), requestStage("CERRADO"));
for (const status of ["RECHAZADO", "ANULADO", "UNKNOWN"]) assert.equal(requestStage(status), -1, "No fabricated completed stages for interruptions");
assert.equal(requestStage(displayedRequestStatus({ status: "PAGADO", financialProgress: { status: "TXT_GENERADO", counts: { total: 3, paid: 1 }, partialPayment: true } })), 4);
console.log("PASS focused role menus, secondary access, canonical stages, partial payment and terminal safety");
