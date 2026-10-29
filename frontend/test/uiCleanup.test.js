import assert from "node:assert/strict";
import { roleNavigation, canAccessNavigation } from "../src/utils/navigationAccess.js";
import { requestStage } from "../src/utils/requestStage.js";
import { displayedRequestStatus } from "../src/utils/requestPresentation.js";
for (const [role, items] of Object.entries(roleNavigation)) {
  // Each role's menu lists its daily work only. Tesorería runs payments, history, reconciliations,
  // transfers, suppliers and Budget Control; the GAF approves, approves batches, transfers and
  // investments and reads the audit; the administrator runs the platform pages. Everyone else
  // keeps a short list.
  assert.ok(items.length <= ({ Treasury: 8, GAF: 7, Admin: 6 }[role] || 5), `${role}: primary menu stays focused`);
  assert.equal(new Set(items.map(([, path]) => path)).size, items.length);
  items.forEach(([, path]) => assert.ok(canAccessNavigation(role, path), `${role}: ${path}`));
}
// Admin is not a superuser: platform pages only, no financial workspace.
assert.deepEqual(roleNavigation.Admin.map(([, path]) => path), ["/", "/users", "/administration/access", "/cost-centers", "/administration/audit", "/administration"]);
assert.ok(!roleNavigation.Admin.some(([, path]) => path === "/accounting/payables"), "Admin opens no financial workspace");
assert.equal(canAccessNavigation("Admin", "/accounting/payables"), false);
assert.deepEqual(roleNavigation.Treasury.map(([, path]) => path), ["/", "/treasury", "/suppliers", "/treasury/history", "/treasury/statement-reviews", "/treasury/transfers", "/budget", "/consultas"], "Treasury also runs Budget Control and the Track D transfers");
assert.deepEqual(roleNavigation.Solicitor.map(([, path]) => path), ["/", "/requests/new", "/requests", "/suppliers"]);
assert.equal(canAccessNavigation("Solicitor", "/suppliers"), true, "Contextual supplier workflow remains accessible");
assert.equal(canAccessNavigation("Solicitor", "/settings"), false);
assert.equal(requestStage("TXT_GENERADO"), 4, "TXT generation does not complete Payment");
assert.equal(requestStage("PAGADO"), 5, "Paid still awaits reconciliation");
assert.equal(requestStage("PAGADO_CERRADO"), requestStage("CERRADO"));
for (const status of ["RECHAZADO", "ANULADO", "UNKNOWN"]) assert.equal(requestStage(status), -1, "No fabricated completed stages for interruptions");
assert.equal(requestStage(displayedRequestStatus({ status: "PAGADO", financialProgress: { status: "TXT_GENERADO", counts: { total: 3, paid: 1 }, partialPayment: true } })), 4);
console.log("PASS focused role menus, secondary access, canonical stages, partial payment and terminal safety");
