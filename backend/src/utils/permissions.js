import { isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { activeApprovalStep } from "../services/approvalRuleService.js";
import { APPROVAL_ROUTING_MODE, APPROVAL_STAGES, PERMISSIONS, REQUEST_STATUS, ROLE_PERMISSIONS, ROLES } from "./constants.js";

export const SUPPLIER_VIEW_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.SOLICITOR, ROLES.PROCUREMENT];
export const REQUEST_CREATOR_ROLES = [ROLES.ADMIN, ROLES.SOLICITOR];

export function permissionsFor(userOrRole) {
  const role = typeof userOrRole === "string" ? userOrRole : userOrRole?.role;
  const rolePermissions = ROLE_PERMISSIONS[role] || [];
  const customPermissions = typeof userOrRole === "object" ? userOrRole.permissions || [] : [];
  return [...new Set([...rolePermissions, ...customPermissions])];
}

export function hasPermission(userOrRole, permission) {
  return permissionsFor(userOrRole).includes(permission);
}

export function canCreateRequest(role) {
  return REQUEST_CREATOR_ROLES.includes(role);
}

export function canViewSuppliers(role) {
  return SUPPLIER_VIEW_ROLES.includes(role);
}

export function canModifyRequest(request, user) {
  if (!request || !user || isTerminalRequest(request.status)) return false;
  if (user.role === ROLES.ADMIN && !["BORRADOR", "DEVUELTO", "OBSERVADO", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA"].includes(request.status)) return false;
  if (user.role === ROLES.ADMIN) return true;
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  return (
    user.role === ROLES.SOLICITOR &&
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
  // Preserves the Area Director/Vice-Rector/Management carve-out exactly: broad but
  // never over other people's drafts. Everyone else with REQUEST_VIEW_ALL
  // (Accounting, Treasury, Budget) keeps its original unrestricted access.
  if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT].includes(user.role)) return request.status !== REQUEST_STATUS.DRAFT;
  return hasPermission(user, PERMISSIONS.REQUEST_VIEW_ALL);
}

export function requestVisibilityFilter(user) {
  if (!user) return { _id: null };
  if (user.role === ROLES.ADMIN) return {};
  if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT].includes(user.role)) {
    return { $or: [{ status: { $ne: REQUEST_STATUS.DRAFT } }, { requester: user._id }, { solicitor: user._id }] };
  }
  if (hasPermission(user, PERMISSIONS.REQUEST_VIEW_ALL)) return {};
  return {
    $or: [
      { requester: user._id },
      { solicitor: user._id },
      { "approvalRouteSnapshot.approverUser": user._id }
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

export function canUseCostCenter(user, costCenterId) {
  if (!user || !costCenterId) return false;
  if (user.role === ROLES.ADMIN) return true;
  const allowed = [user.costCenter, ...(user.authorizedCostCenters || [])]
    .filter(Boolean)
    .map((value) => String(value?._id || value));
  return allowed.includes(String(costCenterId?._id || costCenterId));
}
