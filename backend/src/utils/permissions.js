import mongoose from "mongoose";
import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { activeApprovalStep } from "../services/approvalRuleService.js";
import { APPROVAL_ROUTING_MODE, APPROVAL_STAGES, GRANTABLE_PERMISSIONS, MANAGEMENT_VIEWER_PERMISSIONS, PERMISSIONS, READ_ONLY_OVERSIGHT_ROLES, REQUEST_STATUS, REQUESTER_ROLES, ROLE_PERMISSIONS, ROLES } from "./constants.js";

export const SUPPLIER_VIEW_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ...REQUESTER_ROLES, ROLES.PROCUREMENT, ROLES.GAF, ...READ_ONLY_OVERSIGHT_ROLES];
// Roles whose work reaches supplier records (and their files) beyond their own proposals. Which
// suppliers each one sees is still their department's list (services/supplierVisibilityService.js);
// only the Admin, the GAF and the read-only overseers see every department.
export const SUPPLIER_WORK_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.PROCUREMENT, ROLES.GAF, ...READ_ONLY_OVERSIGHT_ROLES];
export const REQUEST_CREATOR_ROLES = [ROLES.ADMIN, ...REQUESTER_ROLES];
// Who sees which requests (Manual técnico, "Seguridad, perfiles y auditoría": alcance de lectura).
// The GAF, the Gerencia General and Auditoría read every submitted request of the university, never
// other people's drafts.
const SUBMITTED_REQUEST_VIEWERS = [ROLES.MANAGEMENT, ROLES.GAF, ROLES.AUDITOR];
// A Director or Vicerrector reads the submitted requests of their cascade, and a requester those of
// their own cost center (services/costCenterCascadeService.js, computed when they sign in).
export const CASCADE_REQUEST_VIEWERS = [ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR];
export const COST_CENTER_SCOPED_VIEWERS = [...CASCADE_REQUEST_VIEWERS, ...REQUESTER_ROLES];

const idString = (value) => String(value?._id || value || "");

// The cost centers whose submitted requests this person reads besides their own.
export function visibleCostCenterIds(user) {
  const computed = user?.$locals?.visibleCostCenterIds || user?.visibleCostCenterIds;
  if (Array.isArray(computed)) return computed.map(idString).filter(Boolean);
  return user?.costCenter ? [idString(user.costCenter)] : [];
}

function requestCostCenterIds(request) {
  return [request.requesterCostCenter, ...(request.costAllocations || []).map((allocation) => allocation.costCenter)].map(idString).filter(Boolean);
}

export function isSuperAdmin(user) {
  return user?.role === ROLES.SUPER_ADMIN;
}

// The Super Admin and the Auditor: they read every workspace and never act in a process.
export function isReadOnlyOverseer(user) {
  return READ_ONLY_OVERSIGHT_ROLES.includes(user?.role);
}

export function permissionsFor(userOrRole) {
  const role = typeof userOrRole === "string" ? userOrRole : userOrRole?.role;
  const rolePermissions = ROLE_PERMISSIONS[role] || [];
  return [...new Set([...rolePermissions, ...extraGrants(userOrRole)])];
}

// The extra grants that are in force for a user: only grantable permissions (a stored legacy
// value such as "accounting:process" never widens access), and nothing beyond the portal for a
// ManagementViewer.
export function extraGrants(user) {
  if (!user || typeof user !== "object") return [];
  const allowed = user.role === ROLES.MANAGEMENT_VIEWER ? MANAGEMENT_VIEWER_PERMISSIONS : GRANTABLE_PERMISSIONS;
  return (user.permissions || []).filter((permission) => allowed.includes(permission));
}

export function hasPermission(userOrRole, permission) {
  return permissionsFor(userOrRole).includes(permission);
}

// A person who raises their own requests: every Solicitor, Legal and Gestión de Personas user,
// plus anyone granted "Create requests". Requester controls (only own requests, only authorized
// cost centers) apply to them.
export function actsAsRequester(user) {
  return REQUESTER_ROLES.includes(user?.role) || extraGrants(user).includes(PERMISSIONS.REQUEST_CREATE);
}

// A person who proposes suppliers without being Accounting/Admin (every other internal user):
// their proposals stay theirs to correct.
export function actsAsSupplierProposer(user) {
  return ![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user?.role) && hasPermission(user, PERMISSIONS.SUPPLIER_PROPOSE);
}

export function canCreateRequest(role) {
  return REQUEST_CREATOR_ROLES.includes(role);
}

export function canViewSuppliers(userOrRole) {
  const role = typeof userOrRole === "string" ? userOrRole : userOrRole?.role;
  if (SUPPLIER_VIEW_ROLES.includes(role)) return true;
  return [PERMISSIONS.SUPPLIER_PROPOSE, PERMISSIONS.SUPPLIER_BANK_VIEW].some((permission) => hasPermission(userOrRole, permission));
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
  if (user.role === ROLES.ADMIN && !["BORRADOR", "DEVUELTO", "OBSERVADO", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA"].includes(request.status)) return false;
  if (user.role === ROLES.ADMIN) return true;
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

// Visibility is identity-based for the manager chain: a plain Solicitor (which
// most chain approvers are) has no blanket view of other people's requests —
// they see their own, and anything specifically routed to them for approval.
// Roles with REQUEST_VIEW_ALL (Accounting, Treasury, Budget, Management, and
// the Area Director/Vice-Rector approval-pool roles) are unaffected.
export function canViewRequest(request, user) {
  if (!request || !user) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (requesterIdOf(request) === String(user._id)) return true;
  if ((request.approvalRouteSnapshot || []).some((step) => step.approverUser && String(step.approverUser?._id || step.approverUser) === String(user._id))) return true;
  // The heads of the CECOs a Por Encargo request is charged to review it (they are not approvers).
  if ((request.costCenterReviewers || []).some((reviewer) => String(reviewer?._id || reviewer) === String(user._id))) return true;
  // Broad but never over other people's drafts. Everyone else with REQUEST_VIEW_ALL
  // (Accounting, Treasury, Procurement) keeps its unrestricted access.
  if (SUBMITTED_REQUEST_VIEWERS.includes(user.role)) return request.status !== REQUEST_STATUS.DRAFT;
  if (COST_CENTER_SCOPED_VIEWERS.includes(user.role)) {
    if (request.status === REQUEST_STATUS.DRAFT) return false;
    const visible = new Set(visibleCostCenterIds(user));
    return requestCostCenterIds(request).some((id) => visible.has(id));
  }
  return hasPermission(user, PERMISSIONS.REQUEST_VIEW_ALL);
}

export function requestVisibilityFilter(user) {
  if (!user) return { _id: null };
  if (user.role === ROLES.ADMIN) return {};
  if (SUBMITTED_REQUEST_VIEWERS.includes(user.role)) {
    return { $or: [{ status: { $ne: REQUEST_STATUS.DRAFT } }, { requester: user._id }, { solicitor: user._id }] };
  }
  const scoped = COST_CENTER_SCOPED_VIEWERS.includes(user.role);
  if (!scoped && hasPermission(user, PERMISSIONS.REQUEST_VIEW_ALL)) return {};
  const centers = scoped ? visibleCostCenterIds(user).filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id)) : [];
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
  if (user.role === ROLES.ADMIN) return true;
  const level = user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
  return level === (request.approvalStage || APPROVAL_STAGES.AREA_DIRECTOR);
}

// Categoría del puesto (Portal de Personas) that may charge another cost center: Por Encargo, or a
// CECO authorized on the profile (Manual técnico, "Validaciones en línea").
export const ENCARGO_JOB_CATEGORIES = Object.freeze([3, 5, 6]);

export function mayChargeAnotherCostCenter(user) {
  return user?.role === ROLES.ADMIN || ENCARGO_JOB_CATEGORIES.includes(Number(user?.jobCategory));
}

export function canUseCostCenter(user, costCenterId) {
  if (!user || !costCenterId) return false;
  if (user.role === ROLES.ADMIN) return true;
  const allowed = [user.costCenter, ...(user.authorizedCostCenters || [])]
    .filter(Boolean)
    .map((value) => String(value?._id || value));
  const id = String(costCenterId?._id || costCenterId);
  if (id === String(user.costCenter?._id || user.costCenter)) return true;
  return mayChargeAnotherCostCenter(user) && allowed.includes(id);
}
