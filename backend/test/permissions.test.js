import assert from "node:assert/strict";
import test from "node:test";
import { APPROVAL_STAGES, PERMISSIONS, REQUEST_STATUS, ROLES } from "../src/utils/constants.js";
import { canApproveStage, canCreateRequest, canModifyRequest, canViewRequest, canViewSuppliers, hasPermission } from "../src/utils/permissions.js";

const solicitor = { _id: "user-1", role: ROLES.SOLICITOR };
const anotherSolicitor = { _id: "user-2", role: ROLES.SOLICITOR };
const admin = { _id: "admin-1", role: ROLES.ADMIN };
const approver = { _id: "approver-1", role: ROLES.AREA_DIRECTOR };

test("only Admin and Solicitor can create financial requests", () => {
  assert.equal(canCreateRequest(ROLES.ADMIN), true);
  assert.equal(canCreateRequest(ROLES.SOLICITOR), true);
  assert.equal(canCreateRequest(ROLES.AREA_DIRECTOR), false);
  assert.equal(canCreateRequest(ROLES.VICE_RECTOR), false);
  assert.equal(canCreateRequest(ROLES.ACCOUNTING), false);
  assert.equal(canCreateRequest(ROLES.TREASURY), false);
});

test("every internal role can open Suppliers and propose one; the portal-only viewer cannot", () => {
  for (const role of Object.values(ROLES).filter((role) => role !== ROLES.MANAGEMENT_VIEWER)) {
    assert.equal(canViewSuppliers(role), true, role);
    assert.equal(hasPermission(role, PERMISSIONS.SUPPLIER_PROPOSE), true, role);
  }
  assert.equal(canViewSuppliers(ROLES.MANAGEMENT_VIEWER), false);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.SUPPLIER_PROPOSE), false);
  assert.equal(canViewSuppliers(ROLES.ADMIN), true);
  assert.equal(canViewSuppliers(ROLES.SOLICITOR), true);
  assert.equal(canViewSuppliers(ROLES.ACCOUNTING), true);
  assert.equal(canViewSuppliers(ROLES.TREASURY), true);
});

test("Solicitor can modify only owned editable requests; rejected requests remain terminal", () => {
  const ownedDraft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  const ownedRejected = { solicitor: "user-1", status: REQUEST_STATUS.REJECTED };
  const ownedPending = { solicitor: "user-1", status: REQUEST_STATUS.PENDING_APPROVAL };

  assert.equal(canModifyRequest(ownedDraft, solicitor), true);
  assert.equal(canModifyRequest(ownedRejected, solicitor), false);
  assert.equal(canModifyRequest(ownedPending, solicitor), false);
  assert.equal(canModifyRequest(ownedDraft, anotherSolicitor), false);
  assert.equal(canModifyRequest(ownedPending, admin), false);
});

test("Area Director cannot view drafts but Accounting and Treasury retain operational visibility", () => {
  const draft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  assert.equal(canViewRequest(draft, approver), false);
  assert.equal(canViewRequest(draft, { _id: "accounting-1", role: ROLES.ACCOUNTING }), true);
  assert.equal(canViewRequest(draft, { _id: "treasury-1", role: ROLES.TREASURY }), true);
  assert.equal(canViewRequest(draft, solicitor), true);
  assert.equal(canViewRequest(draft, anotherSolicitor), false);
});

test("Area Director and Vice-Rector can act only at their assigned workflow level while Admin can act at either level", () => {
  const directorRequest = { approvalStage: APPROVAL_STAGES.AREA_DIRECTOR };
  const viceRequest = { approvalStage: APPROVAL_STAGES.VICE_RECTOR };
  const director = { role: ROLES.AREA_DIRECTOR, approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR };
  const vice = { role: ROLES.VICE_RECTOR, approvalLevel: APPROVAL_STAGES.VICE_RECTOR };
  assert.equal(canApproveStage(directorRequest, director), true);
  assert.equal(canApproveStage(viceRequest, director), false);
  assert.equal(canApproveStage(viceRequest, vice), true);
  assert.equal(canApproveStage(viceRequest, admin), true);
});

test("permission catalog preserves existing roles and adds Budget and Management capabilities", () => {
  assert.equal(hasPermission({ role: ROLES.BUDGET }, PERMISSIONS.BUDGET_MANAGE), true);
  assert.equal(hasPermission({ role: ROLES.MANAGEMENT }, PERMISSIONS.REPORT_VIEW), true);
  assert.equal(hasPermission({ role: ROLES.SOLICITOR }, PERMISSIONS.PAYMENT_CONFIRM), false);
  assert.equal(hasPermission({ role: ROLES.ADMIN }, PERMISSIONS.AUDIT_VIEW), true);
});

test("Additional permissions granted by Admin are real grants on top of the role", async () => {
  const { GRANTABLE_PERMISSIONS } = await import("../src/utils/constants.js");
  const { actsAsRequester, actsAsSupplierProposer, extraGrants } = await import("../src/utils/permissions.js");
  const { authorizeAccess, authorizePermission } = await import("../src/middleware/auth.js");
  const { allowedRequestActions } = await import("../src/services/requestActionPolicy.js");
  const pass = (middleware, user) => { try { middleware({ user }, {}, () => {}); return true; } catch (error) { if (error.statusCode === 403) return false; throw error; } };

  const treasury = { _id: "t-1", role: ROLES.TREASURY, permissions: [] };
  const treasuryRequester = { _id: "t-2", role: ROLES.TREASURY, permissions: [PERMISSIONS.REQUEST_CREATE, PERMISSIONS.SUPPLIER_PROPOSE, PERMISSIONS.BUDGET_VIEW] };
  // Without the grant the role decides; with it the feature opens for that person only.
  assert.equal(pass(authorizePermission(PERMISSIONS.REQUEST_CREATE), treasury), false);
  assert.equal(pass(authorizePermission(PERMISSIONS.REQUEST_CREATE), treasuryRequester), true);
  assert.equal(pass(authorizePermission(PERMISSIONS.BUDGET_VIEW), treasuryRequester), true);
  // Proposing suppliers needs no grant: every internal role has it; the portal viewer does not.
  assert.equal(pass(authorizeAccess({ roles: [ROLES.ADMIN, ROLES.ACCOUNTING], permissions: [PERMISSIONS.SUPPLIER_PROPOSE] }), treasury), true);
  assert.equal(pass(authorizeAccess({ roles: [ROLES.ADMIN, ROLES.ACCOUNTING], permissions: [PERMISSIONS.SUPPLIER_PROPOSE] }), { role: ROLES.MANAGEMENT_VIEWER, permissions: [] }), false);
  assert.equal(actsAsRequester(treasuryRequester), true);
  assert.equal(actsAsRequester(treasury), false);
  assert.equal(actsAsSupplierProposer(treasuryRequester), true);
  assert.equal(canViewSuppliers(treasuryRequester), true);
  // Proposing suppliers is a default of every internal role, so it is no longer an extra grant.
  assert.equal(GRANTABLE_PERMISSIONS.includes(PERMISSIONS.SUPPLIER_PROPOSE), false);
  assert.equal(actsAsSupplierProposer(treasury), true);
  assert.equal(actsAsSupplierProposer({ _id: "a", role: ROLES.ACCOUNTING, permissions: [] }), false, "Accounting works as finance, not as a proposer");
  // A requester by grant edits and submits their own draft like a Solicitor.
  const ownDraft = { requester: "t-2", status: REQUEST_STATUS.DRAFT, approvalHistory: [] };
  assert.equal(canModifyRequest(ownDraft, treasuryRequester), true);
  assert.ok(allowedRequestActions(ownDraft, treasuryRequester).includes("SUBMIT"));
  assert.equal(canModifyRequest({ ...ownDraft, requester: "someone-else" }, treasuryRequester), false);

  // Department duties are not grantable: a stored legacy value never widens access.
  const legacy = { _id: "s-9", role: ROLES.SOLICITOR, permissions: [PERMISSIONS.ACCOUNTING_PROCESS, PERMISSIONS.PAYMENT_CONFIRM, PERMISSIONS.USER_MANAGE] };
  assert.deepEqual(extraGrants(legacy), []);
  for (const duty of [PERMISSIONS.ACCOUNTING_PROCESS, PERMISSIONS.PAYMENT_CONFIRM, PERMISSIONS.USER_MANAGE]) assert.equal(hasPermission(legacy, duty), false);
  // A ManagementViewer stays portal-only even with a grantable value stored.
  assert.equal(hasPermission({ role: ROLES.MANAGEMENT_VIEWER, permissions: [PERMISSIONS.REPORT_VIEW] }, PERMISSIONS.REPORT_VIEW), false);

  // Role defaults keep today's access: Accounting voids requests, Procurement issues orders.
  assert.equal(hasPermission(ROLES.ACCOUNTING, PERMISSIONS.REQUEST_VOID), true);
  assert.equal(hasPermission(ROLES.PROCUREMENT, PERMISSIONS.PROCUREMENT_ORDER_CREATE), true);
  assert.equal(hasPermission(ROLES.PROCUREMENT, PERMISSIONS.SUPPLIER_BANK_VIEW), false, "Procurement never saw full supplier bank data");

  // Every permission Admin can grant is enforced somewhere in the server (no decorative checkbox).
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith(".js") ? [path.join(dir, entry.name)] : []);
  const code = walk(srcDir).filter((file) => !file.endsWith(path.join("utils", "constants.js"))).map((file) => fs.readFileSync(file, "utf8")).join(String.fromCharCode(10));
  const keyOf = Object.fromEntries(Object.entries(PERMISSIONS).map(([key, value]) => [value, key]));
  for (const permission of GRANTABLE_PERMISSIONS) {
    const key = keyOf[permission];
    const enforced = [
      String.raw`(authorizePermission|authorizeAccess|hasPermission)\([^)]*PERMISSIONS\.` + key + String.raw`\b`,
      String.raw`permissions: \[[^\]]*PERMISSIONS\.` + key + String.raw`\b`,
      String.raw`_PERMISSIONS = Object\.freeze\(\[[^\]]*PERMISSIONS\.` + key + String.raw`\b`,
      String.raw`extraGrants\(user[^)]*\)\.includes\(PERMISSIONS\.` + key + String.raw`\)`
    ].some((pattern) => new RegExp(pattern).test(code));
    assert.ok(enforced, `${permission} is grantable but nothing in the server enforces it`);
  }
});
