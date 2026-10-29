import assert from "node:assert/strict";
import { canAccessNavigation, navigationForUser } from "../src/utils/navigationAccess.js";
import { canStartUmaProcess, UMA_PROCESSES } from "../src/utils/umaProcessSelection.js";

// The menu of each of the eleven roles (Manual de usuario, "Perfiles y menús"), computed from the
// same catalog the API enforces (shared/accessControl.mjs).
const menu = (user) => navigationForUser({ _id: "u", ...user }).map(([, path]) => path);
const expected = {
  Solicitor: ["/", "/requests/new", "/requests", "/suppliers"],
  AreaDirector: ["/", "/requests", "/approvals", "/budget", "/reports"],
  ViceRector: ["/", "/requests", "/approvals", "/budget", "/reports"],
  GAF: ["/", "/approvals", "/accounting/bank-files", "/consultas", "/settings", "/treasury/transfers", "/investments", "/audit"],
  Management: ["/", "/approvals", "/indicadores", "/consultas"],
  Accounting: ["/", "/accounting/payables", "/treasury/statement-reviews", "/accounting/periods", "/consultas", "/settings"],
  Treasury: ["/", "/treasury", "/suppliers", "/treasury/history", "/treasury/statement-reviews", "/treasury/transfers", "/budget", "/consultas", "/settings"],
  Legal: ["/", "/special-expenses", "/requests"],
  HumanResources: ["/", "/special-expenses"],
  Auditor: ["/", "/consultas", "/audit", "/requests"],
  Admin: ["/", "/users", "/administration/access", "/cost-centers", "/administration/audit", "/administration"]
};
for (const [role, paths] of Object.entries(expected)) assert.deepEqual(menu({ role }), paths, role);

// Approvals only with real approval authority.
assert.equal(menu({ role: "Solicitor" }).includes("/approvals"), false, "a Solicitante sees no approval module");
assert.ok(menu({ role: "Solicitor", hasTeam: true }).includes("/approvals"), "a Solicitante who is someone's jefe approves");
assert.ok(menu({ role: "Solicitor", hasPendingApprovals: true }).includes("/approvals"), "a step assigned to them now");

// One employee, several roles: the menus merge, nothing is duplicated.
const solicitorAndDirector = menu({ role: "Solicitor", roles: ["AreaDirector"] });
assert.deepEqual(solicitorAndDirector, ["/", "/requests/new", "/requests", "/suppliers", "/approvals", "/budget", "/reports"]);
const adminAndSolicitor = menu({ role: "Admin", roles: ["Solicitor"] });
assert.ok(adminAndSolicitor.includes("/users") && adminAndSolicitor.includes("/requests/new"));
assert.equal(new Set(adminAndSolicitor).size, adminAndSolicitor.length);

// The administrator reaches no financial workspace; Auditoría no administration screen.
for (const path of ["/treasury", "/accounting/payables", "/accounting/bank-files", "/requests", "/budget", "/consultas", "/suppliers", "/configuration/finance-configurations"]) assert.equal(canAccessNavigation("Admin", path), false, `Admin: ${path}`);
for (const path of ["/users", "/administration/access", "/administration", "/cost-centers"]) assert.equal(canAccessNavigation("Auditor", path), false, `Auditor: ${path}`);
// Contabilidad never schedules or pays; Tesorería never provisions or approves batches.
assert.equal(canAccessNavigation("Accounting", "/treasury"), false);
assert.equal(canAccessNavigation("Treasury", "/accounting/payables"), false);
assert.equal(canAccessNavigation("Treasury", "/accounting/bank-files"), false);
// Retired roles are read as their replacement.
assert.deepEqual(menu({ role: "SuperAdmin" }), expected.Admin);
assert.deepEqual(menu({ role: "ManagementViewer" }), expected.Auditor);

// Who starts each of the eight processes.
const starts = (user) => UMA_PROCESSES.filter((process) => canStartUmaProcess(process, user)).map((process) => process.code);
assert.deepEqual(starts({ role: "Solicitor" }), ["A1", "A2", "B", "C", "M", "E"]);
assert.deepEqual(starts({ role: "HumanResources" }), ["H"]);
assert.deepEqual(starts({ role: "Treasury" }), ["D"]);
assert.deepEqual(starts({ role: "Admin" }), []);
assert.deepEqual(starts({ role: "Auditor" }), []);

console.log("PASS each of the eleven roles gets its manual's menu; merged menus for several roles; who starts each process.");
