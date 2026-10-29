import assert from "node:assert/strict";
import test from "node:test";
import { ROLE_CODES, SCOPES, sodViolations } from "../../shared/accessControl.mjs";
import { APPROVAL_STAGES, CANONICAL_ROLES, GRANTABLE_PERMISSIONS, PERMISSIONS, REQUEST_STATUS, ROLES } from "../src/utils/constants.js";
import { canApproveStage, canCreateRequest, canModifyRequest, canViewRequest, canViewSuppliers, hasPermission, hasRole, permissionsFor, requestViewScope, requestVisibilityFilter } from "../src/utils/permissions.js";
import { authorize, authorizePermission, auditorMayCall } from "../src/middleware/auth.js";

const P = PERMISSIONS;
const solicitor = { _id: "user-1", role: ROLES.SOLICITOR };
const anotherSolicitor = { _id: "user-2", role: ROLES.SOLICITOR };
const admin = { _id: "admin-1", role: ROLES.ADMIN };
const director = { _id: "approver-1", role: ROLES.AREA_DIRECTOR, approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR };
const pass = (middleware, user, method = "POST") => { try { middleware({ user, method }, {}, () => {}); return true; } catch (error) { if (error.statusCode === 403) return false; throw error; } };

test("eleven canonical roles, each with its UMA code", () => {
  assert.deepEqual(CANONICAL_ROLES.map((role) => ROLE_CODES[role]).sort(), ["ADMIN", "AUD", "CON", "GAF", "GG", "GP", "JEF", "LEG", "SOL", "TES", "VIC"]);
  for (const retired of ["SuperAdmin", "Procurement", "ManagementViewer", "Budget"]) assert.equal(CANONICAL_ROLES.includes(retired), false, retired);
});

test("role-permission matrix (Manual técnico, perfiles)", () => {
  const holds = (role, permission) => hasPermission({ role }, permission);
  // Who registers requests: the Solicitante only (others through an additional role or a grant).
  assert.deepEqual(CANONICAL_ROLES.filter((role) => canCreateRequest({ role })), [ROLES.SOLICITOR]);
  // Approval authority: responsables, Vicerrectores, GAF and Gerencia General - never the administrator.
  assert.deepEqual(CANONICAL_ROLES.filter((role) => holds(role, P.REQUEST_APPROVE)).sort(), [ROLES.AREA_DIRECTOR, ROLES.GAF, ROLES.MANAGEMENT, ROLES.VICE_RECTOR].sort());
  // Each financial duty belongs to exactly one department.
  const only = (permission, role) => assert.deepEqual(CANONICAL_ROLES.filter((item) => holds(item, permission)), [role], permission);
  only(P.ACCOUNTING_PROVISION, ROLES.ACCOUNTING);
  only(P.ACCOUNTING_CLOSE_PERIOD, ROLES.ACCOUNTING);
  only(P.RECONCILIATION_SIGN, ROLES.ACCOUNTING);
  only(P.ACCOUNTING_REOPEN_PERIOD, ROLES.GAF);
  only(P.BATCH_APPROVE, ROLES.GAF);
  only(P.FINANCE_PARAMETERS_MANAGE, ROLES.GAF);
  only(P.TREASURY_SCHEDULE, ROLES.TREASURY);
  only(P.TREASURY_GENERATE_BATCH, ROLES.TREASURY);
  only(P.TREASURY_EXECUTE_PAYMENT, ROLES.TREASURY);
  only(P.RECONCILIATION_PREPARE, ROLES.TREASURY);
  only(P.SUPPLIER_VALIDATE, ROLES.TREASURY);
  only(P.LEGAL_REVIEW, ROLES.LEGAL);
  only(P.HONORARIOS_MANAGE, ROLES.HUMAN_RESOURCES);
  only(P.EMPLOYEE_MANAGE, ROLES.ADMIN);
  only(P.ROLE_MANAGE, ROLES.ADMIN);
  only(P.ACTA_ISSUE, ROLES.SOLICITOR);
  // Contabilidad never schedules or pays; Tesorería never provisions or approves its own batch.
  for (const duty of [P.TREASURY_SCHEDULE, P.TREASURY_GENERATE_BATCH, P.TREASURY_EXECUTE_PAYMENT]) assert.equal(holds(ROLES.ACCOUNTING, duty), false, duty);
  for (const duty of [P.ACCOUNTING_PROVISION, P.BATCH_APPROVE, P.RECONCILIATION_SIGN]) assert.equal(holds(ROLES.TREASURY, duty), false, duty);
  // Gerencia General: approvals and reports, no Treasury or Accounting editing.
  assert.deepEqual(permissionsFor(ROLES.MANAGEMENT).sort(), [P.ACTA_SIGN, P.BUDGET_VIEW, P.INSIGHTS_VIEW, P.REPORT_VIEW, P.REQUEST_APPROVE, P.REQUEST_OBSERVE, P.REQUEST_REJECT, P.REQUEST_VIEW].sort());
  // Auditoría reads only.
  assert.deepEqual(permissionsFor(ROLES.AUDITOR).sort(), [P.AUDIT_READ, P.BUDGET_VIEW, P.INSIGHTS_VIEW, P.REPORT_VIEW, P.REQUEST_VIEW, P.SUPPLIER_VIEW].sort());
  // The administrator manages access and nothing financial.
  assert.deepEqual(permissionsFor(ROLES.ADMIN).sort(), [P.AUDIT_READ, P.COST_CENTER_MANAGE, P.EMPLOYEE_MANAGE, P.PERMISSION_MANAGE, P.PLATFORM_MANAGE, P.ROLE_MANAGE].sort());
});

test("data scope of request.view per role", () => {
  const scope = (role) => requestViewScope({ role });
  assert.equal(scope(ROLES.SOLICITOR), SCOPES.COST_CENTER);
  assert.equal(scope(ROLES.AREA_DIRECTOR), SCOPES.APPROVAL_HIERARCHY);
  assert.equal(scope(ROLES.VICE_RECTOR), SCOPES.APPROVAL_HIERARCHY);
  for (const role of [ROLES.GAF, ROLES.MANAGEMENT, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.AUDITOR]) assert.equal(scope(role), SCOPES.UNIVERSITY, role);
  for (const role of [ROLES.LEGAL, ROLES.HUMAN_RESOURCES]) assert.equal(scope(role), SCOPES.OWN, role);
  assert.equal(scope(ROLES.ADMIN), null, "administering accounts is not reading financial work");
});

test("suppliers: the areas and the finance roles see them; Tesorería validates", () => {
  for (const role of CANONICAL_ROLES.filter((role) => ![ROLES.ADMIN, ROLES.LEGAL, ROLES.HUMAN_RESOURCES, ROLES.MANAGEMENT].includes(role))) assert.equal(canViewSuppliers(role), true, role);
  assert.equal(canViewSuppliers(ROLES.ADMIN), false);
  assert.equal(hasPermission(ROLES.AUDITOR, P.SUPPLIER_CREATE), false, "Auditoría never registers");
});

test("Solicitor modifies only owned editable requests; the administrator modifies none", () => {
  const ownedDraft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  assert.equal(canModifyRequest(ownedDraft, solicitor), true);
  assert.equal(canModifyRequest({ ...ownedDraft, status: REQUEST_STATUS.REJECTED }, solicitor), false);
  assert.equal(canModifyRequest({ ...ownedDraft, status: REQUEST_STATUS.PENDING_APPROVAL }, solicitor), false);
  assert.equal(canModifyRequest(ownedDraft, anotherSolicitor), false);
  assert.equal(canModifyRequest(ownedDraft, admin), false);
  assert.equal(canModifyRequest({ ...ownedDraft, status: REQUEST_STATUS.OBSERVED }, admin), false);
});

test("nobody reads other people's drafts; the administrator reads no financial request", () => {
  const draft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  const sent = { solicitor: "user-1", status: REQUEST_STATUS.PENDING_APPROVAL, requesterCostCenter: "cc-9" };
  for (const role of [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF, ROLES.MANAGEMENT, ROLES.AUDITOR, ROLES.AREA_DIRECTOR]) {
    assert.equal(canViewRequest(draft, { _id: `${role}-1`, role }), false, role);
  }
  for (const role of [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF, ROLES.MANAGEMENT, ROLES.AUDITOR]) assert.equal(canViewRequest(sent, { _id: `${role}-1`, role }), true, role);
  assert.equal(canViewRequest(draft, solicitor), true);
  assert.equal(canViewRequest(sent, admin), false);
  assert.equal(canViewRequest(sent, { _id: "legal-1", role: ROLES.LEGAL }), false, "Legal reads only its cases");
  // A responsable reads their cascade; another cost center stays hidden.
  assert.equal(canViewRequest(sent, { ...director, visibleCostCenterIds: ["cc-9"] }), true);
  assert.equal(canViewRequest(sent, { ...director, visibleCostCenterIds: ["cc-1"] }), false);
  // The list filter of the administrator is identity-only (own or assigned).
  const filter = requestVisibilityFilter(admin);
  assert.ok(filter.$or.every((clause) => !("status" in clause)), "no cost-center or university branch for the administrator");
});

test("approval stages: no administrator override", () => {
  const directorRequest = { approvalStage: APPROVAL_STAGES.AREA_DIRECTOR };
  const viceRequest = { approvalStage: APPROVAL_STAGES.VICE_RECTOR };
  const vice = { role: ROLES.VICE_RECTOR, approvalLevel: APPROVAL_STAGES.VICE_RECTOR };
  assert.equal(canApproveStage(directorRequest, director), true);
  assert.equal(canApproveStage(viceRequest, director), false);
  assert.equal(canApproveStage(viceRequest, vice), true);
  assert.equal(canApproveStage(viceRequest, admin), false);
  assert.equal(canApproveStage(directorRequest, admin), false);
});

test("one employee, several roles: permissions add up, the API guards see every role", () => {
  const solicitorAndDirector = { _id: "p-1", role: ROLES.SOLICITOR, roles: [ROLES.AREA_DIRECTOR] };
  assert.equal(hasRole(solicitorAndDirector, ROLES.AREA_DIRECTOR), true);
  assert.equal(canCreateRequest(solicitorAndDirector), true);
  assert.equal(hasPermission(solicitorAndDirector, P.REQUEST_APPROVE), true);
  assert.equal(requestViewScope(solicitorAndDirector), SCOPES.APPROVAL_HIERARCHY, "the broadest scope of their roles");
  assert.equal(pass(authorize(ROLES.AREA_DIRECTOR), solicitorAndDirector), true);
  const adminAndSolicitor = { _id: "p-2", role: ROLES.ADMIN, roles: [ROLES.SOLICITOR] };
  assert.equal(pass(authorizePermission(P.EMPLOYEE_MANAGE), adminAndSolicitor), true);
  assert.equal(pass(authorizePermission(P.REQUEST_CREATE), adminAndSolicitor), true);
  assert.equal(pass(authorizePermission(P.ACCOUNTING_PROVISION), adminAndSolicitor), false);
});

test("segregation of duties between roles", () => {
  const ids = (roles) => sodViolations(roles).map((rule) => `${rule.id}:${rule.severity}`).sort();
  assert.deepEqual(ids([ROLES.TREASURY, ROLES.GAF]), ["BATCH_GENERATE_APPROVE:block"]);
  assert.deepEqual(ids([ROLES.ACCOUNTING, ROLES.TREASURY]), ["PROVISION_PAY:block"]);
  assert.deepEqual(ids([ROLES.AUDITOR, ROLES.SOLICITOR]), ["AUDIT_INDEPENDENCE:block"]);
  assert.deepEqual(ids([ROLES.ACCOUNTING, ROLES.GAF]), ["ACCOUNTING_GAF:review"]);
  assert.deepEqual(ids([ROLES.ADMIN, ROLES.GAF]), ["ADMIN_BUSINESS_ROLE:review"]);
  assert.deepEqual(ids([ROLES.SOLICITOR, ROLES.AREA_DIRECTOR]), []);
  assert.deepEqual(ids([ROLES.ADMIN, ROLES.SOLICITOR]), []);
});

test("route guards are permissions; Auditoría reads financial work and changes nothing", () => {
  const auditor = { _id: "aud-1", role: ROLES.AUDITOR };
  assert.equal(pass(authorizePermission(P.TREASURY_SCHEDULE), auditor, "GET"), true, "reads the Treasury queue");
  assert.equal(pass(authorizePermission(P.TREASURY_SCHEDULE), auditor, "POST"), false);
  assert.equal(pass(authorizePermission(P.EMPLOYEE_MANAGE), auditor, "GET"), false, "never the administration screens");
  assert.equal(pass(authorizePermission(P.TREASURY_SCHEDULE), admin, "GET"), false, "the administrator does not read Treasury");
  assert.equal(pass(authorizePermission(P.BATCH_APPROVE), { role: ROLES.TREASURY }), false);
  assert.equal(pass(authorizePermission(P.BATCH_APPROVE), { role: ROLES.GAF }), true);
  assert.equal(auditorMayCall("GET", "/api/requests"), true);
  assert.equal(auditorMayCall("POST", "/api/approvals/1/approve"), false);
  assert.equal(auditorMayCall("GET", "/api/SIRE/Export"), false, "official exports record history");
  assert.equal(auditorMayCall("PATCH", "/api/notifications/abc/read"), true);
});

test("legacy stored values are read through the catalog and never widen access", async () => {
  const { extraGrants } = await import("../src/utils/permissions.js");
  // Retired roles act as their replacement until the migration rewrites them.
  assert.equal(hasRole({ role: "SuperAdmin" }, ROLES.ADMIN), true);
  assert.equal(hasRole({ role: "Procurement" }, ROLES.SOLICITOR), true);
  assert.equal(hasRole({ role: "ManagementViewer" }, ROLES.AUDITOR), true);
  assert.equal(hasPermission({ role: "SuperAdmin" }, P.REQUEST_VIEW), false);
  // "request:create" (old format) is still a grant; department duties never are.
  assert.deepEqual(extraGrants({ role: ROLES.TREASURY, permissions: ["request:create", "accounting:process", "user:manage"] }), [P.REQUEST_CREATE]);
  assert.equal(hasPermission({ role: ROLES.SOLICITOR, permissions: ["accounting:process"] }, P.ACCOUNTING_PROVISION), false);
  assert.equal(hasPermission({ role: ROLES.SOLICITOR, permissions: ["procurement-order:create"] }, P.PURCHASE_ORDER_ISSUE), true);
});

test("every grantable permission is enforced somewhere in the server (no decorative checkbox)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith(".js") ? [path.join(dir, entry.name)] : []);
  const code = walk(srcDir).filter((file) => !file.endsWith(path.join("utils", "constants.js"))).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const keyOf = Object.fromEntries(Object.entries(PERMISSIONS).map(([key, value]) => [value, key]));
  for (const permission of GRANTABLE_PERMISSIONS) {
    const key = keyOf[permission];
    const enforced = [
      String.raw`(authorizePermission|authorizeAccess|hasPermission)\([^)]*PERMISSIONS\.` + key + String.raw`\b`,
      String.raw`permission: [^,]*PERMISSIONS\.` + key + String.raw`\b`,
      String.raw`extraGrants\(user[^)]*\)\.includes\(PERMISSIONS\.` + key + String.raw`\)`
    ].some((pattern) => new RegExp(pattern).test(code));
    assert.ok(enforced, `${permission} is grantable but nothing in the server enforces it`);
  }
});

test("processes M, H and E follow the manual's routes, without unnecessary approvals", async () => {
  const { routeStages } = await import("../src/routes/umaSpecialRoutes.js");
  const uit = 5500;
  assert.deepEqual(await routeStages("E", 100, uit, null), ["LEGAL", "DIRECTOR"]);
  assert.deepEqual(await routeStages("E", 6 * uit, uit, null), ["LEGAL", "DIRECTOR", "GAF"]);
  assert.deepEqual(await routeStages("E", 25 * uit, uit, null), ["LEGAL", "DIRECTOR", "GAF"], "Gerencia General never signs a refund");
  assert.deepEqual(await routeStages("H", 100, uit, null), ["DIRECTOR", "GAF"], "honorarios always reach the GAF");
  assert.deepEqual(await routeStages("M", 100, uit, null), ["DIRECTOR"], "small mobility needs no GAF");
  assert.deepEqual(await routeStages("M", 6 * uit, uit, null), ["DIRECTOR", "GAF"]);
  assert.deepEqual(await routeStages("M", 21 * uit, uit, null), ["DIRECTOR", "GAF", "GG"]);
});
