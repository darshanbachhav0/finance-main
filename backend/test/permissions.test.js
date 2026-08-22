import assert from "node:assert/strict";
import test from "node:test";
import { APPROVAL_STAGES, PERMISSIONS, REQUEST_STATUS, ROLES } from "../src/utils/constants.js";
import { canApproveStage, canCreateRequest, canModifyRequest, canViewRequest, canViewSuppliers, hasPermission } from "../src/utils/permissions.js";

const solicitor = { _id: "user-1", role: ROLES.SOLICITOR };
const anotherSolicitor = { _id: "user-2", role: ROLES.SOLICITOR };
const admin = { _id: "admin-1", role: ROLES.ADMIN };
const approver = { _id: "approver-1", role: ROLES.APPROVER };

test("only Admin and Solicitor can create financial requests", () => {
  assert.equal(canCreateRequest(ROLES.ADMIN), true);
  assert.equal(canCreateRequest(ROLES.SOLICITOR), true);
  assert.equal(canCreateRequest(ROLES.APPROVER), false);
  assert.equal(canCreateRequest(ROLES.ACCOUNTING), false);
  assert.equal(canCreateRequest(ROLES.TREASURY), false);
});

test("Approver cannot access Suppliers while operational roles can", () => {
  assert.equal(canViewSuppliers(ROLES.APPROVER), false);
  assert.equal(canViewSuppliers(ROLES.ADMIN), true);
  assert.equal(canViewSuppliers(ROLES.SOLICITOR), true);
  assert.equal(canViewSuppliers(ROLES.ACCOUNTING), true);
  assert.equal(canViewSuppliers(ROLES.TREASURY), true);
});

test("Solicitor can modify only owned draft or rejected requests", () => {
  const ownedDraft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  const ownedRejected = { solicitor: "user-1", status: REQUEST_STATUS.REJECTED };
  const ownedPending = { solicitor: "user-1", status: REQUEST_STATUS.PENDING_APPROVAL };

  assert.equal(canModifyRequest(ownedDraft, solicitor), true);
  assert.equal(canModifyRequest(ownedRejected, solicitor), true);
  assert.equal(canModifyRequest(ownedPending, solicitor), false);
  assert.equal(canModifyRequest(ownedDraft, anotherSolicitor), false);
  assert.equal(canModifyRequest(ownedPending, admin), true);
});

test("Approver cannot view drafts but Accounting and Treasury retain operational visibility", () => {
  const draft = { solicitor: "user-1", status: REQUEST_STATUS.DRAFT };
  assert.equal(canViewRequest(draft, approver), false);
  assert.equal(canViewRequest(draft, { _id: "accounting-1", role: ROLES.ACCOUNTING }), true);
  assert.equal(canViewRequest(draft, { _id: "treasury-1", role: ROLES.TREASURY }), true);
  assert.equal(canViewRequest(draft, solicitor), true);
  assert.equal(canViewRequest(draft, anotherSolicitor), false);
});

test("Approvers can act only at their assigned workflow level while Admin can act at either level", () => {
  const directorRequest = { approvalStage: APPROVAL_STAGES.AREA_DIRECTOR };
  const viceRequest = { approvalStage: APPROVAL_STAGES.VICE_RECTOR };
  const director = { role: ROLES.APPROVER, approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR };
  const vice = { role: ROLES.APPROVER, approvalLevel: APPROVAL_STAGES.VICE_RECTOR };
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
