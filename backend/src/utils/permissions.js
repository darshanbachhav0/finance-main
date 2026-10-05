import { canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { activeApprovalStep } from "../services/approvalRuleService.js";
import { APPROVAL_ROUTING_MODE, APPROVAL_STAGES, GRANTABLE_PERMISSIONS, MANAGEMENT_VIEWER_PERMISSIONS, PERMISSIONS, REQUEST_STATUS, ROLE_PERMISSIONS, ROLES } from "./constants.js";

export const SUPPLIER_VIEW_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.SOLICITOR, ROLES.PROCUREMENT];
// Roles that work with every supplier (not only the proposals they made themselves).
export const SUPPLIER_WORK_ROLES = [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.PROCUREMENT];
export const REQUEST_CREATOR_ROLES = [ROLES.ADMIN, ROLES.SOLICITOR];

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

// A person who raises their own requests: every Solicitor, plus anyone granted "Create requests".
// Requester controls (only own requests, only authorized cost centers) apply to them.
export function actsAsRequester(user) {
  return user?.role === ROLES.SOLICITOR || extraGrants(user).includes(PERMISSIONS.REQUEST_CREATE);
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
