import assert from "node:assert/strict";
import fs from "node:fs";
import { accountMenuPaths, authenticatedRoles, bottomNavigationForUser, canAccessNavigation, homePath, internalRoles, navigationForUser, pageLabel, pageTrail, reportDownloadRoles } from "../src/utils/navigationAccess.js";
import { isReadOnlyRole, readOnlyMayCall } from "../src/utils/readOnly.js";
import { journeyMilestones, journeySummary, expectedPayment } from "../src/utils/requestJourney.js";
import { nextStepFor } from "../src/utils/nextStep.js";
import { laterStagesText, mustSendUp } from "../src/utils/approvalOptions.js";
import { transferRoute } from "../src/utils/treasuryTransfer.js";
import trackDSpanish from "../src/context/i18n/trackD.js";
import { umaCopy } from "../src/utils/umaPresentation.js";

// The Spanish the app shows for a code or English key (LanguageContext.translateMessage, reduced
// to the dictionaries these strings live in).
const translateMessage = (text, language) => { const display = umaCopy[text] || text; return language === "en" ? display : trackDSpanish[display] || display; };

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const menu = (user) => navigationForUser(user).map(([, path]) => path);

// 1. The new roles sign in; the Auditor is the only read-only role and opens the "/" dashboard.
for (const role of ["GAF", "Legal", "HumanResources", "Auditor"]) assert.ok(authenticatedRoles.includes(role), `${role} signs in`);
assert.equal(isReadOnlyRole("Auditor"), true);
for (const role of ["Admin", "SuperAdmin", "GAF", "Treasury"]) assert.equal(isReadOnlyRole(role), false, `${role} is not read-only`);
assert.equal(isReadOnlyRole("ManagementViewer"), true, "the retired ManagementViewer reads as Auditor");
assert.equal(internalRoles.includes("Auditor"), false, "the Auditor never acts in a process");
for (const path of ["/super-admin", "/management-view", "/requests/new", "/approvals", "/my-team", "/reimbursement-bank"]) assert.equal(canAccessNavigation("Auditor", path, { role: "Auditor", hasTeam: true }), false, `Auditor has no ${path}`);
for (const path of ["/", "/requests", "/budget", "/reports", "/consultas", "/indicadores", "/audit", "/investments", "/suppliers"]) assert.equal(canAccessNavigation("Auditor", path), true, `Auditor reads ${path}`);
for (const path of ["/treasury", "/treasury/transfers", "/accounting", "/users", "/administration/audit"]) assert.equal(canAccessNavigation("Auditor", path), false, `Auditor has no ${path}`);
assert.equal(canAccessNavigation("Auditor", "/accounting/bank-files"), false, "Auditor cannot access GAF-only bank approval");
assert.equal(homePath("Auditor"), "/");
assert.deepEqual(menu({ role: "Auditor" }), ["/", "/consultas", "/audit", "/requests"]);
assert.deepEqual(pageTrail("/requests/abc", { role: "Auditor" }).map((item) => item.label), ["Home", "Financial history", "Request details"]);
assert.equal(readOnlyMayCall("post", "/notifications/abc/read"), true);
assert.equal(readOnlyMayCall("put", "/users/me/notification-preferences"), true);
assert.equal(readOnlyMayCall("get", "/requests"), true, "reads always pass");
assert.equal(readOnlyMayCall("put", "/work-drafts/x"), false, "the Auditor saves no drafts (backend AUDITOR_WRITE_PATHS)");
assert.equal(readOnlyMayCall("post", "/requests"), false);
const backendAuth = read("../../backend/src/middleware/auth.js");
const auditorPaths = JSON.parse(backendAuth.match(/AUDITOR_WRITE_PATHS = Object\.freeze\((\[[^\]]+\])\)/)[1]).map((path) => path.replace(/^\/api/, ""));
for (const path of auditorPaths) assert.equal(readOnlyMayCall("post", `${path}x`), true, `browser lets the Auditor call ${path}`);

// 2. GAF: approvals, batch approval, transfers, investments, consultas, audit, budget and reports.
for (const path of ["/requests", "/approvals", "/accounting/bank-files", "/budget", "/reports", "/consultas", "/investments", "/audit", "/treasury/transfers", "/settings"]) assert.equal(canAccessNavigation("GAF", path), true, `GAF opens ${path}`);
for (const path of ["/requests/new", "/management-view", "/treasury", "/accounting/payables"]) assert.equal(canAccessNavigation("GAF", path), false, `GAF has no ${path}`);
assert.deepEqual(menu({ role: "GAF" }), ["/", "/approvals", "/accounting/bank-files", "/consultas", "/settings", "/treasury/transfers", "/investments", "/audit"]);
assert.ok(reportDownloadRoles.includes("GAF") && reportDownloadRoles.includes("Auditor"));

// 3. Legal validates student refunds (process E) and Gestión de Personas uploads honorarios
//    (process H); neither registers requests by role. Approvals only as someone's jefe.
assert.deepEqual(menu({ role: "Legal" }), ["/", "/special-expenses", "/requests"]);
assert.deepEqual(menu({ role: "HumanResources" }), ["/", "/special-expenses"]);
assert.equal(pageLabel("/special-expenses", "Legal"), "Refunds to validate");
assert.equal(pageLabel("/requests", "Legal"), "Consultas");
assert.equal(pageLabel("/special-expenses", "HumanResources"), "Honorarios");
assert.equal(canAccessNavigation("Legal", "/requests/new"), false, "Legal validates E, it does not register requests");
assert.equal(canAccessNavigation("HumanResources", "/requests/new"), true, "honorarios.manage starts process H");
for (const role of ["Legal", "HumanResources"]) {
  for (const path of ["/requests", "/special-expenses"]) assert.equal(canAccessNavigation(role, path), true, `${role} opens ${path}`);
  for (const path of ["/reimbursement-bank", "/reports", "/suppliers", "/treasury"]) assert.equal(canAccessNavigation(role, path), false, `${role} has no ${path}`);
  assert.deepEqual(accountMenuPaths({ role }), [], `${role} keeps no reimbursement account by role`);
  assert.ok(!menu({ role }).includes("/approvals") && menu({ role, hasTeam: true }).includes("/approvals"));
  assert.equal(bottomNavigationForUser({ role })[0].path, "/");
}
assert.deepEqual(bottomNavigationForUser({ role: "Legal" }).map((item) => item.path), ["/", "/special-expenses", "/requests"]);
// A Legal user who also holds Solicitor registers requests and keeps their bank account.
assert.equal(canAccessNavigation({ role: "Legal", roles: ["Solicitor"] }, "/requests/new"), true);
assert.deepEqual(accountMenuPaths({ role: "Solicitor" }), ["/reimbursement-bank"]);

// 4. Transfers page: Treasury registers and executes (treasury.transfer), the GAF approves the
//    batch, Accounting posts it. The administrator and the Auditor do not open it.
assert.equal(pageLabel("/treasury/transfers"), "Transfers");
for (const role of ["Treasury", "GAF", "Accounting"]) assert.equal(canAccessNavigation(role, "/treasury/transfers"), true, role);
for (const role of ["Admin", "SuperAdmin", "Auditor", "Solicitor", "Legal", "Procurement", "Management"]) assert.equal(canAccessNavigation(role, "/treasury/transfers"), false, role);
assert.deepEqual(pageTrail("/treasury/transfers", { role: "Treasury" }).map((item) => item.label), ["Home", "Scheduling and payments", "Transfers"]);
assert.match(read("../src/App.jsx"), /page\("\/treasury\/transfers", <TreasuryTransfers \/>\)/);
const page = read("../src/pages/TreasuryTransfers.jsx");
for (const call of ['"/treasury/transfers"', '"/treasury/accounts"', "/execute`", "/reconcile`", "/resubmit`"]) assert.ok(page.includes(call), `the page calls ${call}`);
assert.match(page, /const canManage = !readOnly && userCan\(user, PERMISSIONS\.TREASURY_TRANSFER\)/, "only treasury.transfer acts");

// 5. Track D request: journey, next step and labels without a supplier.
const transfer = { _id: "t1", flowType: "D", requestType: "TRASPASO", status: "APROBADO", requester: { _id: "u1", name: "Ana" }, totalAmount: 1000, currency: "PEN", treasuryTransfer: { purpose: "FUNDING", sourceAccount: { code: "BBVA-PEN" }, destinationAccount: { code: "BCP-PEN" } } };
assert.equal(transferRoute(transfer), "BBVA-PEN → BCP-PEN");
assert.deepEqual(journeyMilestones(transfer).map((step) => step.key), ["submitted", "approved", "transferred", "reconciled", "closed"]);
assert.equal(expectedPayment(transfer), null);
assert.equal(journeySummary(transfer).holder.name, "Treasury");
const pending = { ...transfer, status: "PENDIENTE_APROBACION" };
assert.deepEqual(journeySummary(pending, { activeStep: { tier: "GAF", approvalLevel: "GAF", status: "PENDING" } }).holder, { name: "GAF", team: true });
const execute = nextStepFor({ request: transfer, user: { _id: "u2", role: "Treasury" } });
assert.equal(execute.key, "executeTransfer");
assert.equal(execute.action.href, "/treasury/transfers?request=t1");
assert.equal(nextStepFor({ request: { ...transfer, status: "PAGADO" }, user: { _id: "u2", role: "Treasury" } }).key, "reconcileTransfer");
assert.equal(nextStepFor({ request: { ...transfer, status: "OBSERVADO" }, user: { _id: "u1", role: "Treasury" }, permissions: { modifiable: true } }).key, "resubmitTransfer");
assert.equal(nextStepFor({ request: pending, user: { _id: "u3", role: "GAF" }, permissions: { canApprove: true } }).key, "approve");
assert.equal(translateMessage("D · Transfer between accounts", "es"), "D · Traspaso entre cuentas");

// 6. Approval options: a step above the superior threshold is sent up, never finalized; later
//    role-based steps are named.
assert.equal(mustSendUp({ chain: true, canFinalize: false, superiorRequired: true }), true);
assert.equal(mustSendUp({ chain: true, canFinalize: true, superiorRequired: false }), false);
assert.equal(mustSendUp({ chain: false, canFinalize: true }), false);
assert.equal(laterStagesText({ remainingPolicyStages: ["GAF", "GENERAL_MANAGEMENT"] }, (text) => translateMessage(text, "es")), "Gerencia de Administración Financiera, Gerencia General");
for (const [code, spanish] of [["TREASURY_HEAD", "Jefe de Tesorería"], ["GAF", "Gerencia de Administración Financiera"], ["Management", "Gerencia General"], ["Legal", "Asesoría Legal"], ["HumanResources", "Gestión de Personas"], ["Auditor", "Auditoría (solo lectura)"]]) {
  assert.equal(translateMessage(code, "es"), spanish, code);
}
assert.equal(translateMessage("GAF", "en"), "Financial Administration Management");

console.log("PASS new roles (GAF, Legal, Human Resources, Auditor), Track D transfers page, journey and next step, superior-required approvals");
