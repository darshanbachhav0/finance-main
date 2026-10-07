import assert from "node:assert/strict";
import { authenticatedRoles, groupNavigation, navigationForUser, navigationSections, pageLabels, pageTrail, settingsPagesFor, settingsPaths } from "../src/utils/navigationAccess.js";

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
assert.deepEqual(accounting.map((group) => group.label), ["Overview", "My work", "Invoices and payables", "Accounting", "Master Data"]);
assert.deepEqual(accounting.find((group) => group.label === "Invoices and payables").items.map((item) => item.path), ["/batch-invoices", "/accounting/invoice-observations", "/accounting/payables", "/accounting/bank-files"]);
// Accounting verifies bank files; Treasury downloads them afterwards and has no verification page.
assert.ok(!navigationForUser({ role: "Treasury" }).some(([, path]) => path === "/accounting/bank-files"));
assert.deepEqual(accounting.find((group) => group.label === "Accounting").items.map((item) => item.path), ["/accounting", "/accounting/periods", "/accounting/sire"]);
// A permission-granted page lands in its section, not at the end of the list.
const treasuryRequester = grouped({ role: "Treasury", permissions: ["request:create"] });
assert.deepEqual(treasuryRequester.find((group) => group.label === "My work").items.map((item) => item.path), ["/requests", "/requests/new", "/operations"]);
assert.equal(treasuryRequester[1].label, "My work", "My work comes right after Overview");

// Settings is one menu entry; a single settings page is linked directly.
const menu = (user) => navigationForUser(user).map(([, path]) => path);
assert.ok(menu({ role: "Accounting" }).includes("/settings"));
assert.ok(menu({ role: "Budget" }).includes("/settings"), "Budget reaches budget rules and allocations");
assert.ok(!menu({ role: "Treasury" }).includes("/settings"));
assert.ok(menu({ role: "Treasury" }).includes("/configuration/bank-formats"), "Treasury's only settings page is linked directly");
assert.ok(menu({ role: "Solicitor", permissions: ["bank-format:certify"] }).includes("/configuration/bank-formats"));
for (const role of ["Solicitor", "AreaDirector", "Procurement", "Management", "ManagementViewer"]) assert.ok(!menu({ role }).includes("/settings"), `${role} has no settings`);
assert.deepEqual(settingsPagesFor({ role: "Accounting" }), ["/cost-centers", "/expense-types", "/configuration/accounting-mappings", "/configuration/finance-configurations", "/exchange-rates"]);
assert.equal(settingsPagesFor({ role: "Admin" }).length, settingsPaths.length, "Admin opens every settings page");

// Admin works from the menu, not from a hub page.
const admin = menu({ role: "Admin" });
for (const path of ["/requests", "/approvals", "/accounting/payables", "/treasury", "/accounting", "/budget", "/reports", "/suppliers", "/settings", "/operations"]) assert.ok(admin.includes(path), `Admin menu has ${path}`);
assert.ok(!admin.includes("/administration") && !admin.includes("/accounting/invoices"), "the old hub pages are gone");
for (const path of Object.keys(pageLabels)) assert.ok(navigationSections.some(([, paths]) => paths.includes(path)), `${path} belongs to a menu section`);

// Breadcrumbs.
const trail = (path, user = { role: "Admin" }) => pageTrail(path, user).map((item) => [item.label, item.path]);
assert.deepEqual(trail("/"), [["Dashboard", undefined]]);
assert.deepEqual(trail("/budget"), [["Dashboard", "/"], ["Budget Control", undefined]]);
assert.deepEqual(trail("/requests/abc123"), [["Dashboard", "/"], ["Requests", "/requests"], ["Request details", undefined]]);
assert.deepEqual(trail("/requests/abc123/edit"), [["Dashboard", "/"], ["Requests", "/requests"], ["Request details", "/requests/abc123"], ["Edit request", undefined]]);
assert.deepEqual(trail("/requests/new", { role: "Solicitor" }), [["Dashboard", "/"], ["My Requests", "/requests"], ["New request", undefined]]);
assert.deepEqual(trail("/treasury/history"), [["Dashboard", "/"], ["Payments", "/treasury"], ["Payment History", undefined]]);
assert.deepEqual(trail("/users"), [["Dashboard", "/"], ["Settings", "/settings"], ["Users", undefined]]);
assert.deepEqual(trail("/configuration/bank-formats", { role: "Treasury" }), [["Dashboard", "/"], ["Bank Formats", undefined]], "no Settings level for a single settings page");
assert.deepEqual(trail("/budget/"), trail("/budget"), "a trailing slash is ignored");
console.log("PASS The sidebar groups every role's menu into fixed sections in a stable order; Settings is one entry; breadcrumbs follow the page hierarchy.");
