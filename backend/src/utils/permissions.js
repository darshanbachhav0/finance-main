import mongoose from "mongoose";
import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { can, effectivePermissions, extraGrants as catalogExtraGrants, hasRole, permissionScope, permissionScopes, primaryRole, rolesOf } from "../../../shared/accessControl.mjs";
import { activeApprovalStep } from "../services/approvalRuleService.js";
import { APPROVAL_ROUTING_MODE, APPROVAL_STAGES, PERMISSIONS, READ_ONLY_OVERSIGHT_ROLES, REQUEST_STATUS, REQUESTER_ROLES, ROLES, SCOPES } from "./constants.js";

export { hasRole, permissionScopes, primaryRole, rolesOf };

// Roles whose work reaches supplier records (and their files) beyond their own proposals. Which
// suppliers each one sees is still their department's list (services/supplierVisibilityService.js);
// only the GAF and Auditoría see every department.
export const SUPPLIER_WORK_ROLES = [ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF, ...READ_ONLY_OVERSIGHT_ROLES];

const idString = (value) => String(value?._id || value || "");

// The data scope of "request.view" for this person (shared/accessControl.mjs): OWN, COST_CENTER,
// APPROVAL_HIERARCHY or UNIVERSITY; null when they hold no request view at all (the
// administrator, unless they also hold a business role).
export function requestViewScope(user) {
  return permissionScope(user, PERMISSIONS.REQUEST_VIEW);
}

// Whose cost-center cascade is computed when they sign in (middleware/auth.js): requesters read
// their own cost center, a responsible or Vicerrector the cascade below them.
export function readsByCostCenter(user) {
  return [SCOPES.COST_CENTER, SCOPES.APPROVAL_HIERARCHY].includes(requestViewScope(user));
}

// The cost centers whose submitted requests this person reads besides their own.
export function visibleCostCenterIds(user) {
  const computed = user?.$locals?.visibleCostCenterIds || user?.visibleCostCenterIds;
  if (Array.isArray(computed)) return computed.map(idString).filter(Boolean);
  return user?.costCenter ? [idString(user.costCenter)] : [];
}

function requestCostCenterIds(request) {
  return [request.requesterCostCenter, ...(request.costAllocations || []).map((allocation) => allocation.costCenter)].map(idString).filter(Boolean);
}

// Auditoría: reads the institution's financial history and never acts in a process.
export function isReadOnlyOverseer(user) {
  return hasRole(user, READ_ONLY_OVERSIGHT_ROLES);
}

export function permissionsFor(userOrRole) {
  return effectivePermissions(userOrRole);
}

// The extra grants that are in force for a user: only grantable permissions (a stored legacy
// value such as "accounting:process" never widens access).
export function extraGrants(user) {
  return catalogExtraGrants(user);
}

export function hasPermission(userOrRole, permission) {
  return can(userOrRole, permission);
}

// A person who raises their own requests: every Solicitante, plus anyone granted "Registrar
// requerimientos". Requester controls (only own requests, only authorized cost centers) apply.
export function actsAsRequester(user) {
  return hasRole(user, REQUESTER_ROLES) || extraGrants(user).includes(PERMISSIONS.REQUEST_CREATE);
}

// A person who proposes suppliers without validating them (everyone but Tesorería): their
// proposals stay theirs to correct.
export function actsAsSupplierProposer(user) {
  return !hasPermission(user, PERMISSIONS.SUPPLIER_VALIDATE) && hasPermission(user, PERMISSIONS.SUPPLIER_CREATE);
}

export function canCreateRequest(userOrRole) {
  return hasPermission(userOrRole, PERMISSIONS.REQUEST_CREATE);
}

export function canViewSuppliers(userOrRole) {
  return [PERMISSIONS.SUPPLIER_VIEW, PERMISSIONS.SUPPLIER_CREATE, PERMISSIONS.SUPPLIER_BANK_VIEW].some((permission) => hasPermission(userOrRole, permission));
}

// SUNAT confirmed the supplier but could not verify the individual invoice (SUNAT down, or the
// Padron-only mode, which can never verify a CPE), or the SUNAT integration failed. Nothing the
// requester edits changes that: only Accounting's manual SUNAT exception resolves it. Older
// observations predate observation.resolver and are recognised by their SUNAT status code.
const SUNAT_UNVERIFIED_CODES = ["PADRON_RUC_VERIFIED_CPE_NOT_VALIDATED", "COMPROBANTE_NO_VERIFICADO"];

// OBSERVADO_PRESUPUESTO: Budget/Management resolve the budget exception (resolver BUDGET); only
// after Management rejects it does the request go back to its requester (resolver REQUESTER).
export function observationOwner(request) {
  const status = canonicalRequestStatus(request?.status);
  if (status === REQUEST_STATUS.OBSERVED_BUDGET) return request.observation?.resolver || "REQUESTER";
  if (status !== REQUEST_STATUS.OBSERVED_SUNAT) return undefined;
  if (request.observation?.resolver) return request.observation.resolver;
  return SUNAT_UNVERIFIED_CODES.includes(request.observation?.code) ? "ACCOUNTING" : "REQUESTER";
}

// A request that was ever sent for approval keeps its approval history: it can be voided, not deleted.
export function wasSubmitted(request) {
  return (request?.approvalHistory || []).some((entry) => entry.action === "APPROVAL_REQUESTED");
}

export function canModifyRequest(request, user) {
  if (!request || !user || isTerminalRequest(request.status)) return false;
  // Resubmitting would only repeat the approvals and end in the same observation.
  if (["ACCOUNTING", "BUDGET"].includes(observationOwner(request))) return false;
  // An issued order is an approved snapshot. Invoice observations must be
  // corrected through invoice registration, not by restarting request approval.
  if (request.purchaseOrder) return false;
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  return (
    actsAsRequester(user) &&
    String(ownerId) === String(user._id) &&
    [
      REQUEST_STATUS.DRAFT,
      REQUEST_STATUS.RETURNED,
      REQUEST_STATUS.OBSERVED,
      REQUEST_STATUS.OBSERVED_BUDGET,
      REQUEST_STATUS.OBSERVED_SUNAT,
      REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED,
      REQUEST_STATUS.OBSERVED_BATCH
    ].includes(request.status)
  );
}

function requesterIdOf(request) {
  return String(request.requester?._id || request.requester || request.solicitor?._id || request.solicitor || "");
}

// The requester may withdraw a submitted request back to draft until the first
// approver decides: only while it is still PENDIENTE_APROBACION and no step of
// its current approval route has been APPROVED.
export function canWithdrawRequest(request, user) {
  if (!request || !user || user.active === false) return false;
  if (requesterIdOf(request) !== String(user._id)) return false;
  if (canonicalRequestStatus(request.status) !== REQUEST_STATUS.PENDING_APPROVAL) return false;
  return !(request.approvalRouteSnapshot || []).some((step) => step.status === "APPROVED");
}

// Who reads a request (Manual técnico, "Alcance de lectura"): its requester, anyone a step of its
// route is assigned to, the heads of the CECOs it is charged to, and - never over other people's
// drafts - whoever holds "request.view": OWN reads nothing more, COST_CENTER / APPROVAL_HIERARCHY
// the cost centers computed at sign-in (their own, or their cascade), UNIVERSITY everything
// submitted. The administrator holds no request view: administering accounts is not reading
// financial work.
function involved(request, user) {
  if (requesterIdOf(request) === String(user._id)) return true;
  if ((request.approvalRouteSnapshot || []).some((step) => step.approverUser && String(step.approverUser?._id || step.approverUser) === String(user._id))) return true;
  return (request.costCenterReviewers || []).some((reviewer) => String(reviewer?._id || reviewer) === String(user._id));
}

export function canViewRequest(request, user) {
  if (!request || !user) return false;
  if (involved(request, user)) return true;
  if (request.status === REQUEST_STATUS.DRAFT) return false;
  const scope = requestViewScope(user);
  if (scope === SCOPES.UNIVERSITY) return true;
  if (scope === SCOPES.COST_CENTER || scope === SCOPES.APPROVAL_HIERARCHY) {
    const visible = new Set(visibleCostCenterIds(user));
    return requestCostCenterIds(request).some((id) => visible.has(id));
  }
  return false;
}

export function requestVisibilityFilter(user) {
  if (!user) return { _id: null };
  const scope = requestViewScope(user);
  if (scope === SCOPES.UNIVERSITY) {
    return { $or: [{ status: { $ne: REQUEST_STATUS.DRAFT } }, { requester: user._id }, { solicitor: user._id }] };
  }
  const centers = readsByCostCenter(user) ? visibleCostCenterIds(user).filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id)) : [];
  return {
    $or: [
      { requester: user._id },
      { solicitor: user._id },
      { "approvalRouteSnapshot.approverUser": user._id },
      { costCenterReviewers: user._id },
      ...(centers.length ? [{ status: { $ne: REQUEST_STATUS.DRAFT }, $or: [{ requesterCostCenter: { $in: centers } }, { "costAllocations.costCenter": { $in: centers } }] }] : [])
    ]
  };
}

export function isActiveChainApprover(request, user) {
  if (!request || !user) return false;
  const step = activeApprovalStep(request);
  return Boolean(step) && step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN && String(step.approverUser?._id || step.approverUser) === String(user._id);
}

export function canApproveStage(request, user) {
  if (!request || !user || !hasPermission(user, PERMISSIONS.REQUEST_APPROVE)) return false;
  const level = user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
  return level === (request.approvalStage || APPROVAL_STAGES.AREA_DIRECTOR);
}

// Categoría del puesto (Portal de Personas) that may charge another cost center: Por Encargo, or a
// CECO authorized on the profile (Manual técnico, "Validaciones en línea").
export const ENCARGO_JOB_CATEGORIES = Object.freeze([3, 5, 6]);

export function mayChargeAnotherCostCenter(user) {
  return ENCARGO_JOB_CATEGORIES.includes(Number(user?.jobCategory));
}

export function canUseCostCenter(user, costCenterId) {
  if (!user || !costCenterId) return false;
  const allowed = [user.costCenter, ...(user.authorizedCostCenters || [])]
    .filter(Boolean)
    .map((value) => String(value?._id || value));
  const id = String(costCenterId?._id || costCenterId);
  if (id === String(user.costCenter?._id || user.costCenter)) return true;
  return mayChargeAnotherCostCenter(user) && allowed.includes(id);
}
