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

// 1. The new roles sign in; Auditor is read-only like the Super Admin but has no console.
for (const role of ["GAF", "Legal", "HumanResources", "Auditor"]) assert.ok(authenticatedRoles.includes(role), `${role} signs in`);
assert.equal(isReadOnlyRole("Auditor"), true);
assert.equal(internalRoles.includes("Auditor"), false, "the Auditor never acts in a process");
for (const path of ["/super-admin", "/requests/new", "/approvals", "/my-team", "/reimbursement-bank"]) assert.equal(canAccessNavigation("Auditor", path, { role: "Auditor", hasTeam: true }), false, `Auditor has no ${path}`);
for (const path of ["/requests", "/treasury", "/treasury/transfers", "/accounting", "/accounting/bank-files", "/budget", "/reports", "/management-view", "/suppliers", "/users"]) assert.equal(canAccessNavigation("Auditor", path), true, `Auditor reads ${path}`);
assert.equal(homePath("Auditor"), "/requests");
assert.deepEqual(pageTrail("/requests/abc", { role: "Auditor" }).map((item) => item.label), ["Requests", "Request details"], "no repeated Requests level");
assert.equal(readOnlyMayCall("post", "/notifications/abc/read", "Auditor"), true);
assert.equal(readOnlyMayCall("put", "/users/me/notification-preferences", "Auditor"), true);
assert.equal(readOnlyMayCall("put", "/work-drafts/x", "Auditor"), false, "the Auditor saves no drafts (backend AUDITOR_WRITE_PATHS)");
assert.equal(readOnlyMayCall("put", "/work-drafts/x", "SuperAdmin"), true);
const backendAuth = read("../../backend/src/middleware/auth.js");
const auditorPaths = JSON.parse(backendAuth.match(/AUDITOR_WRITE_PATHS = Object\.freeze\((\[[^\]]+\])\)/)[1]).map((path) => path.replace(/^\/api/, ""));
for (const path of auditorPaths) assert.equal(readOnlyMayCall("post", `${path}x`, "Auditor"), true, `browser lets the Auditor call ${path}`);

// 2. GAF: approvals, bank-file approval, transfers, budget, reports, management portal.
for (const path of ["/requests", "/approvals", "/accounting/bank-files", "/budget", "/reports", "/management-view", "/treasury/transfers"]) assert.equal(canAccessNavigation("GAF", path), true, `GAF opens ${path}`);
assert.equal(canAccessNavigation("GAF", "/requests/new"), false);
assert.ok(menu({ role: "GAF" }).includes("/approvals") && menu({ role: "GAF" }).includes("/treasury/transfers"));
assert.ok(reportDownloadRoles.includes("GAF") && reportDownloadRoles.includes("Auditor"));

// 3. Legal and Human Resources work like a Solicitor: My Requests, new request, own bank account
//    in the account menu, Approvals only as someone's jefe. Human Resources also opens Reports.
for (const role of ["Legal", "HumanResources"]) {
  assert.equal(pageLabel("/requests", role), "My Requests");
  for (const path of ["/requests", "/requests/new", "/approvals", "/reimbursement-bank"]) assert.equal(canAccessNavigation(role, path), true, `${role} opens ${path}`);
  assert.deepEqual(accountMenuPaths({ role }), ["/reimbursement-bank"]);
  assert.ok(!menu({ role }).includes("/approvals") && menu({ role, hasTeam: true }).includes("/approvals"));
  assert.ok(!menu({ role }).includes("/suppliers"), "requesters propose suppliers from the request form");
  assert.deepEqual(bottomNavigationForUser({ role }).map((item) => item.path), ["/", "/requests", "/requests/new"]);
}
assert.equal(canAccessNavigation("HumanResources", "/reports"), true);
assert.equal(canAccessNavigation("Legal", "/reports"), false);

// 4. Transfers page: a Treasury page, read by the GAF, Accounting and the read-only overseers.
assert.equal(pageLabel("/treasury/transfers"), "Transfers");
for (const role of ["Admin", "Treasury", "GAF", "Accounting", "SuperAdmin", "Auditor"]) assert.equal(canAccessNavigation(role, "/treasury/transfers"), true, role);
for (const role of ["Solicitor", "Legal", "Procurement", "Management"]) assert.equal(canAccessNavigation(role, "/treasury/transfers"), false, role);
assert.deepEqual(pageTrail("/treasury/transfers", { role: "Treasury" }).map((item) => item.label), ["Dashboard", "Payments", "Transfers"]);
assert.match(read("../src/App.jsx"), /path="treasury\/transfers" element=\{<ProtectedRoute roles=\{navigationAccess\["\/treasury\/transfers"\]\} \/>\}/);
const page = read("../src/pages/TreasuryTransfers.jsx");
for (const call of ['"/treasury/transfers"', '"/treasury/accounts"', "/execute`", "/reconcile`", "/resubmit`"]) assert.ok(page.includes(call), `the page calls ${call}`);
assert.match(page, /const canManage = !readOnly && \["Admin", "Treasury"\]\.includes\(user\.role\)/, "only Treasury and Admin act");

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
