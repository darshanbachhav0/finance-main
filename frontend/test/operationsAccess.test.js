import assert from "node:assert/strict";
import fs from "node:fs";
import { dashboardMetricLink, AWAITING_PURCHASE_ORDER_PATH } from "../src/utils/dashboardLinks.js";
import { initialTableQuery } from "../src/utils/initialTableQuery.js";
import { canAccessNavigation, configurationAccess, navigationForUser, reportDownloadRoles } from "../src/utils/navigationAccess.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const menu = (role) => navigationForUser({ role }).map(([, path]) => path);

// Configuration: Treasury reaches bank-format certification and (the former Budget role's) budget
// rules; the GAF sets the financial parameters; Accounting keeps its accounting mappings.
assert.equal(canAccessNavigation("Treasury", "/configuration/bank-formats"), true);
assert.equal(canAccessNavigation("Treasury", "/configuration/budget-rules"), true);
assert.equal(canAccessNavigation("Budget", "/configuration/budget-rules"), true, "a not-yet-migrated Budget account reads as Treasury");
assert.equal(canAccessNavigation("Budget", "/budget"), canAccessNavigation("Treasury", "/budget"));
assert.equal(canAccessNavigation("GAF", "/configuration/finance-configurations"), true);
assert.equal(canAccessNavigation("Accounting", "/configuration/finance-configurations"), false, "financial parameters belong to the GAF");
assert.equal(canAccessNavigation("Accounting", "/configuration/accounting-mappings"), true);
assert.equal(canAccessNavigation("Solicitor", "/configuration/unknown-resource"), false);
assert.equal(canAccessNavigation("Accounting", "/configuration/unknown-resource"), true, "/configuration/* covers the route");
assert.equal(canAccessNavigation("Treasury", "/settings"), true);
// Budget Control's "Configuration" related-tools link (/configuration/budget-rules) now shows.
assert.match(read("../src/pages/BudgetControl.jsx"), /\["Configuration", "\/configuration\/budget-rules"\]/);
// Accounting's daily work: posting, reconciliations it signs, periods, queries and its settings.
for (const path of ["/accounting/payables", "/treasury/statement-reviews", "/accounting/periods", "/consultas", "/settings"]) {
  assert.ok(menu("Accounting").includes(path), `Accounting menu has ${path}`);
}
const app = read("../src/App.jsx");
// The configuration route opens for any configuration rule; "Certify bank formats" granted to a
// user opens bank formats only.
assert.match(app, /path="configuration\/:resource" element=\{<ProtectedRoute path="\/configuration\/\*" \/>\}/);
assert.equal(canAccessNavigation({ role: "Solicitor", permissions: ["bank_format.certify"] }, "/configuration/bank-formats"), true);
assert.equal(configurationAccess["budget-rules"]({ role: "Solicitor", permissions: ["bank_format.certify"] }), false);
// Each resource has one rule (user => boolean), and the configuration page reads the same rules.
const master = read("../src/pages/MasterConfiguration.jsx");
assert.match(master, /import \{ configurationAccess \} from "\.\.\/utils\/navigationAccess\.js"/);
assert.match(master, /canOpen = \(key\) => Boolean\(configurationAccess\[key\]\?\.\(user\)\)/);
const opens = (role) => Object.keys(configurationAccess).filter((resource) => configurationAccess[resource]({ role }));
for (const rule of Object.values(configurationAccess)) assert.equal(typeof rule, "function");
assert.deepEqual(opens("GAF"), ["approval-rules", "finance-configurations"]);
assert.deepEqual(opens("Accounting"), ["accounting-mappings"]);
assert.deepEqual(opens("Treasury"), ["budget-rules", "budget-allocations", "bank-formats"]);
assert.deepEqual(opens("Admin"), ["approval-rules"], "the administrator reviews the approval hierarchy only");
for (const role of ["Solicitor", "AreaDirector", "ViceRector", "Management", "Legal", "HumanResources", "Auditor"]) assert.deepEqual(opens(role), [], `${role} opens no configuration`);
// Only the GAF edits the approval thresholds; the administrator reads them.
assert.match(master, /"approval-rules": \{\s*label: "Approval Rules", writePermission: PERMISSIONS\.FINANCE_PARAMETERS_MANAGE/);

// Report history: download buttons only for roles the backend lets download stored reports.
const fileAccess = read("../../backend/src/services/fileAccessService.js");
const backendReportRoles = fileAccess.match(/reports: \[([^\]]+)\]/)[1].split(",").map((item) => item.trim().replace("ROLES.", ""));
const roleNames = { ADMIN: "Admin", AREA_DIRECTOR: "AreaDirector", VICE_RECTOR: "ViceRector", ACCOUNTING: "Accounting", TREASURY: "Treasury", MANAGEMENT: "Management", GAF: "GAF", AUDITOR: "Auditor" };
assert.deepEqual([...reportDownloadRoles].sort(), backendReportRoles.map((role) => roleNames[role]).sort());
for (const role of ["Procurement", "SuperAdmin", "ManagementViewer", "Admin"]) assert.equal(reportDownloadRoles.includes(role), false, `${role} downloads no stored reports`);
assert.match(read("../src/pages/ManagementReports.jsx"), /canDownloadReportFiles \? <ProtectedAssetButton/);

// Dashboard drill-downs open filtered lists.
assert.equal(dashboardMetricLink("Solicitor", "returned").to, "/requests?status=DEVUELTO%2COBSERVADO");
assert.equal(dashboardMetricLink("Solicitor", "pending").to, "/requests?status=PENDIENTE_APROBACION%2CAPROBADO_DIRECTOR%2CAPROBADO_VICERRECTOR");
// The purchase-order queue (the retired Procurement role is now a Solicitor with purchase_order.issue).
assert.equal(dashboardMetricLink("Solicitor", "awaitingOrder").to, AWAITING_PURCHASE_ORDER_PATH);
assert.equal(dashboardMetricLink("Procurement", "awaitingOrder").to, AWAITING_PURCHASE_ORDER_PATH, "a not-yet-migrated Procurement account reads as Solicitor");
assert.deepEqual(dashboardMetricLink("Admin", "awaitingOrder"), {}, "no link to a page the administrator cannot open");
assert.match(read("../../backend/src/controllers/dashboardController.js"), /AWAITING_PURCHASE_ORDER_PATH = "\/requests\?status=PENDIENTE_OC"/);

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
for (const text of ["Your session has expired. Sign in again to continue; your drafts were kept.", "Sign out anyway", "Stay signed in", "Too many failed sign-in attempts. Try again in 15 minutes."]) {
  assert.ok(spanish[text], `Spanish copy for: ${text}`);
}
console.log("PASS operations access: configuration routes, report downloads, drill-downs, URL filters and session expiry");
