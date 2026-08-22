import { APPROVAL_STAGES, PERMISSIONS, REQUEST_STATUS, ROLE_PERMISSIONS, ROLES } from "./constants.js";

export const SUPPLIER_VIEW_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.SOLICITOR];
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
  if (!request || !user) return false;
  if (user.role === ROLES.ADMIN) return true;
  const ownerId = request.requester?._id || request.requester || request.solicitor?._id || request.solicitor;
  return (
    user.role === ROLES.SOLICITOR &&
    String(ownerId) === String(user._id) &&
    [
      REQUEST_STATUS.DRAFT,
      REQUEST_STATUS.REJECTED,
      REQUEST_STATUS.RETURNED,
      REQUEST_STATUS.OBSERVED,
      REQUEST_STATUS.OBSERVED_BUDGET,
      REQUEST_STATUS.OBSERVED_SUNAT,
      REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED,
      REQUEST_STATUS.OBSERVED_BATCH
    ].includes(request.status)
  );
}

export function canViewRequest(request, user) {
  if (!request || !user) return false;
  if (user.role === ROLES.SOLICITOR) {
    return String(request.requester?._id || request.requester || request.solicitor?._id || request.solicitor) === String(user._id);
  }
  if ([ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role)) return request.status !== REQUEST_STATUS.DRAFT;
  return hasPermission(user, PERMISSIONS.REQUEST_VIEW_ALL) || user.role === ROLES.ADMIN;
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
