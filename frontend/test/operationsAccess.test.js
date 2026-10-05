import assert from "node:assert/strict";
import fs from "node:fs";
import { dashboardMetricLink, AWAITING_PURCHASE_ORDER_PATH } from "../src/utils/dashboardLinks.js";
import { initialTableQuery } from "../src/utils/initialTableQuery.js";
import { canAccessNavigation, configurationAccess, navigationForUser, reportDownloadRoles } from "../src/utils/navigationAccess.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const menu = (role) => navigationForUser({ role }).map(([, path]) => path);

// Configuration: Treasury reaches bank-format certification; Budget and Accounting get their links.
assert.equal(canAccessNavigation("Treasury", "/configuration/bank-formats"), true);
assert.equal(canAccessNavigation("Treasury", "/configuration/budget-rules"), false);
assert.equal(canAccessNavigation("Budget", "/configuration/budget-rules"), true);
assert.equal(canAccessNavigation("Accounting", "/configuration/finance-configurations"), true);
assert.equal(canAccessNavigation("Solicitor", "/configuration/unknown-resource"), false);
assert.equal(canAccessNavigation("Accounting", "/configuration/unknown-resource"), true, "/configuration/* covers the route");
assert.ok(menu("Treasury").includes("/configuration/bank-formats"));
// Budget Control's "Configuration" related-tools link (/configuration/budget-rules) now shows.
assert.match(read("../src/pages/BudgetControl.jsx"), /\["Configuration", "\/configuration\/budget-rules"\]/);
for (const path of ["/suppliers", "/accounting/invoice-observations", "/accounting/periods"]) {
  assert.ok(menu("Accounting").includes(path), `Accounting menu has ${path}`);
}
const app = read("../src/App.jsx");
// "Certify bank formats" granted to a user also opens the configuration route (bank formats only).
assert.match(app, /path="configuration\/:resource" element=\{<ProtectedRoute roles=\{configurationRoles\} permissions=\{\["bank-format:certify"\]\} \/>\}/);
// The per-resource roles mirror the configuration page.
const master = read("../src/pages/MasterConfiguration.jsx");
for (const [resource, roles] of Object.entries(configurationAccess)) {
  const block = master.slice(master.indexOf(`"${resource}": {`));
  assert.match(block.slice(0, 400), new RegExp(`roles: \\[${roles.map((role) => `"${role}"`).join(", ")}\\]`), `${resource} roles match MasterConfiguration`);
}

// Report history: download buttons only for roles the backend lets download stored reports.
const fileAccess = read("../../backend/src/services/fileAccessService.js");
const backendReportRoles = fileAccess.match(/reports: \[([^\]]+)\]/)[1].split(",").map((item) => item.trim().replace("ROLES.", ""));
const roleNames = { ADMIN: "Admin", AREA_DIRECTOR: "AreaDirector", VICE_RECTOR: "ViceRector", ACCOUNTING: "Accounting", TREASURY: "Treasury", BUDGET: "Budget", MANAGEMENT: "Management", PROCUREMENT: "Procurement" };
assert.deepEqual([...reportDownloadRoles].sort(), backendReportRoles.map((role) => roleNames[role]).sort());
assert.equal(reportDownloadRoles.includes("Procurement"), false);
assert.match(read("../src/pages/ManagementReports.jsx"), /canDownloadReportFiles \? <ProtectedAssetButton/);

// Dashboard drill-downs open filtered lists.
assert.equal(dashboardMetricLink("Solicitor", "returned").to, "/requests?status=DEVUELTO%2COBSERVADO");
assert.equal(dashboardMetricLink("Solicitor", "pending").to, "/requests?status=PENDIENTE_APROBACION%2CAPROBADO_DIRECTOR%2CAPROBADO_VICERRECTOR");
assert.equal(dashboardMetricLink("Procurement", "awaitingOrder").to, AWAITING_PURCHASE_ORDER_PATH);
assert.match(read("../../backend/src/controllers/dashboardController.js"), /AWAITING_PURCHASE_ORDER_PATH = "\/requests\?status=PENDIENTE_OC"/);
assert.match(read("../src/pages/Dashboard.jsx"), /AWAITING_PURCHASE_ORDER_PATH, "Review requests"/);

// URL filters replace saved filters instead of merging with them.
const stored = { page: 4, pageSize: 25, search: "old", sort: { key: "createdAt", direction: "asc" }, filters: { status: "CERRADO", currency: "USD" } };
const empty = { status: "", currency: "", requestType: "" };
const drill = initialTableQuery(stored, { initialFilters: { ...empty, status: "BORRADOR" } });
assert.deepEqual(drill.filters, { ...empty, status: "BORRADOR" });
assert.equal(drill.page, 1);
assert.equal(drill.search, "");
assert.equal(drill.pageSize, 25);
assert.deepEqual(drill.sort, stored.sort);
const restored = initialTableQuery(stored, { initialFilters: empty });
assert.deepEqual(restored.filters, { ...empty, ...stored.filters });
assert.equal(restored.page, 4);
assert.deepEqual(initialTableQuery(null, { initialFilters: empty, initialPageSize: 10 }), { page: 1, pageSize: 10, search: "", filters: empty, sort: null });

// Session expiry and sign-out.
const client = read("../src/api/client.js");
assert.match(client, /error\.response\?\.status === 401/);
assert.match(client, /SESSION_EXPIRED_EVENT/);
for (const path of ["/auth/login", "/auth/change-password", "/auth/logout"]) assert.ok(client.includes(`"${path}"`), `${path} 401s are not session expiry`);
const auth = read("../src/context/AuthContext.jsx");
assert.equal(auth.includes("window.confirm"), false);
assert.match(auth, /<ConfirmDialog/);
assert.match(auth, /api\.post\("\/auth\/logout"\)/);
assert.match(auth, /error\?\.status === 401/);
const spanish = (await import("../src/context/i18n/operations.js")).default;
for (const text of ["Your session has expired. Sign in again to continue; your drafts were kept.", "Sign out anyway", "Stay signed in", "This account is temporarily locked after repeated failed sign-in attempts. Try again later."]) {
  assert.ok(spanish[text], `Spanish copy for: ${text}`);
}
console.log("PASS operations access: configuration routes, report downloads, drill-downs, URL filters and session expiry");
