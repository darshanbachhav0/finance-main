import assert from "node:assert/strict";
import { authenticatedRoles, canAccessNavigation, groupNavigation, navigationForUser, navigationSections, pageLabels, pageTrail, settingsPagesFor } from "../src/utils/navigationAccess.js";

// The sidebar groups every role's menu into the same fixed sections, in the same order.
const grouped = (user) => groupNavigation(navigationForUser(user).map(([label, path]) => ({ label, path })));
const order = navigationSections.map(([label]) => label);
for (const role of authenticatedRoles) {
  const groups = grouped({ role, hasTeam: true, hasPendingApprovals: true });
  assert.ok(groups.length > 0, `${role} has a menu`);
  assert.deepEqual(groups.map((group) => group.label), order.filter((label) => groups.some((group) => group.label === label)), `${role} sections keep their order`);
  assert.ok(groups.every((group) => group.items.length > 0), `${role} has no empty section`);
  const flat = groups.flatMap((group) => group.items.map((item) => item.path));
  assert.deepEqual([...flat].sort(), navigationForUser({ role, hasTeam: true, hasPendingApprovals: true }).map(([, path]) => path).sort(), `${role} keeps every menu entry`);
}
const accounting = grouped({ role: "Accounting" });
assert.deepEqual(accounting.map((group) => group.label), ["Overview", "Accounting", "Treasury", "Queries", "Master Data"]);
assert.deepEqual(accounting.find((group) => group.label === "Accounting").items.map((item) => item.path), ["/accounting/payables", "/accounting/periods"]);
// Contabilidad signs the reconciliations Tesorería prepares.
assert.deepEqual(accounting.find((group) => group.label === "Treasury").items.map((item) => item.path), ["/treasury/statement-reviews"]);
// The GAF approves payment batches; neither Tesorería (which generates them) nor Contabilidad has that page.
assert.ok(navigationForUser({ role: "GAF" }).some(([, path]) => path === "/accounting/bank-files"));
for (const role of ["Treasury", "Accounting"]) assert.ok(!navigationForUser({ role }).some(([, path]) => path === "/accounting/bank-files"), `${role} does not approve batches`);
// A page another role adds lands in its section, not at the end of the list.
const treasuryRequester = grouped({ role: "Treasury", roles: ["Solicitor"] });
assert.deepEqual(treasuryRequester.find((group) => group.label === "My work").items.map((item) => item.path), ["/requests/new", "/requests"]);
assert.equal(treasuryRequester[1].label, "My work", "My work comes right after Overview");

// Settings is one menu entry; a single settings page is linked directly.
const menu = (user) => navigationForUser(user).map(([, path]) => path);
assert.ok(menu({ role: "Accounting" }).includes("/settings"));
assert.deepEqual(settingsPagesFor({ role: "Accounting" }), ["/cost-centers", "/expense-types", "/configuration/accounting-mappings", "/exchange-rates"]);
// The GAF sets the financial parameters and approval thresholds.
assert.ok(menu({ role: "GAF" }).includes("/settings"));
assert.deepEqual(settingsPagesFor({ role: "GAF" }), ["/configuration/finance-configurations", "/configuration/approval-rules"]);
// Treasury took over the Budget role: bank formats plus budget rules and allocations.
assert.ok(canAccessNavigation({ role: "Treasury" }, "/settings"), "Treasury reaches bank formats, budget rules and allocations");
assert.deepEqual(settingsPagesFor({ role: "Treasury" }), ["/exchange-rates", "/configuration/budget-rules", "/configuration/budget-allocations", "/configuration/bank-formats"]);
assert.ok(menu({ role: "Treasury" }).includes("/budget"), "Treasury runs Budget Control");
// An extra grant opens its page without adding a menu entry of its own.
assert.deepEqual(settingsPagesFor({ role: "Solicitor", permissions: ["bank_format.certify"] }), ["/configuration/bank-formats"]);
assert.ok(canAccessNavigation({ role: "Solicitor", permissions: ["bank_format.certify"] }, "/configuration/bank-formats"));
// A session whose server-computed permissions open a single settings page links straight to it.
const single = menu({ role: "Accounting", effectivePermissions: ["accounting.provision", "treasury.schedule"] });
assert.ok(single.includes("/exchange-rates") && !single.includes("/settings"));
// Retired roles read as their replacement (Procurement -> Solicitor, ManagementViewer -> Auditor).
for (const role of ["Solicitor", "AreaDirector", "ViceRector", "Management", "Legal", "HumanResources", "Auditor", "Procurement", "ManagementViewer"]) {
  assert.ok(!menu({ role }).includes("/settings"), `${role} has no settings`);
  assert.equal(canAccessNavigation({ role }, "/settings"), false, `${role} cannot open settings`);
}

// The administrator runs the platform, not the finances: employees, roles, hierarchy, audit.
const admin = menu({ role: "Admin" });
assert.deepEqual(admin, ["/", "/users", "/administration/access", "/cost-centers", "/administration/audit", "/administration"]);
for (const path of ["/requests", "/requests/new", "/accounting/payables", "/treasury", "/accounting", "/budget", "/reports", "/suppliers", "/consultas", "/audit"]) {
  assert.ok(!admin.includes(path), `Admin menu has no ${path}`);
  assert.equal(canAccessNavigation({ role: "Admin" }, path), false, `Admin cannot open ${path}`);
}
assert.ok(!admin.includes("/approvals"), "Admin has no approval authority");
assert.deepEqual(settingsPagesFor({ role: "Admin" }), ["/cost-centers", "/configuration/approval-rules"], "Admin manages the hierarchy and reviews the approval rules only");
// The retired Super Admin reads as Admin, with the same menu.
assert.deepEqual(menu({ role: "SuperAdmin" }), admin);
// Work review (/operations) was removed from every menu.
for (const role of authenticatedRoles) assert.ok(!menu({ role, hasTeam: true, hasPendingApprovals: true }).includes("/operations"), `${role} has no Work review`);
assert.ok(!admin.includes("/accounting/invoices") && !admin.includes("/super-admin"), "the old hub pages are gone");
for (const path of Object.keys(pageLabels)) assert.ok(navigationSections.some(([, paths]) => paths.includes(path)), `${path} belongs to a menu section`);

// Breadcrumbs.
const trail = (path, user = { role: "Accounting" }) => pageTrail(path, user).map((item) => [item.label, item.path]);
assert.deepEqual(trail("/"), [["Home", undefined]]);
assert.deepEqual(trail("/budget", { role: "Treasury" }), [["Home", "/"], ["Budget Control", undefined]]);
assert.deepEqual(trail("/requests/abc123"), [["Home", "/"], ["Requests", "/requests"], ["Request details", undefined]]);
assert.deepEqual(trail("/requests/abc123/edit"), [["Home", "/"], ["Requests", "/requests"], ["Request details", "/requests/abc123"], ["Edit request", undefined]]);
assert.deepEqual(trail("/requests/new", { role: "Solicitor" }), [["Home", "/"], ["My Requests", "/requests"], ["New request", undefined]]);
assert.deepEqual(trail("/treasury/history", { role: "Treasury" }), [["Home", "/"], ["Scheduling and payments", "/treasury"], ["Payment History", undefined]]);
assert.deepEqual(trail("/users", { role: "Admin" }), [["Home", "/"], ["Employees", undefined]]);
assert.deepEqual(trail("/administration/alerts", { role: "Admin" }), [["Home", "/"], ["Platform", "/administration"], ["Security alerts", undefined]]);
assert.deepEqual(trail("/configuration/bank-formats", { role: "Solicitor", permissions: ["bank_format.certify"] }), [["Home", "/"], ["Bank Formats", undefined]], "no Settings level for a single settings page");
assert.deepEqual(trail("/configuration/bank-formats", { role: "Treasury" }), [["Home", "/"], ["Settings", "/settings"], ["Bank Formats", undefined]], "Treasury has several settings pages");
assert.deepEqual(trail("/budget/"), trail("/budget"), "a trailing slash is ignored");
console.log("PASS The sidebar groups every role's menu into fixed sections in a stable order; Settings is one entry; breadcrumbs follow the page hierarchy.");
