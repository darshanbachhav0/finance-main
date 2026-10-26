import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import { ROLES } from "../utils/constants.js";
import { notificationText, notifyUser } from "./notificationService.js";
import { paginatedPayload, parsePagination } from "./queryService.js";
import { SECURITY_ALERT_KINDS, securityAlertKind, securityAlertQuery } from "./securityAlertRules.js";

function alertMessage(kind, audit, entity) {
  const actor = audit.actorName || "System";
  const name = entity?.name || audit.newValues?.name || "";
  switch (kind) {
    case "PERIOD_REOPENED": return notificationText("{actor} reopened accounting period {period}.", { actor, period: entity?.period || audit.period || "" });
    case "APPROVAL_RULE_CHANGED": return notificationText("{actor} changed the approval rule {name}.", { actor, name });
    case "BANK_FORMAT_CHANGED": return notificationText("{actor} changed a bank file format.", { actor });
    case "PERMISSIONS_CHANGED": return notificationText("{actor} changed the additional permissions of {name}.", { actor, name });
    case "FINANCE_ROLE_ASSIGNED": return notificationText("{actor} gave {name} the {role} role.", { actor, name, role: audit.newValues?.role || "" });
    default: return null;
  }
}

// Called by recordAudit for every audit it stores: a sensitive one reaches each active Super Admin
// as a bell notification (and its email copy). Never throws - an alert must not undo the action.
export async function raiseSecurityAlert(audit, entity) {
  try {
    const kind = securityAlertKind(audit);
    if (!kind) return [];
    const message = alertMessage(kind, audit, entity && typeof entity === "object" ? entity : undefined);
    const superAdmins = await User.find({ role: ROLES.SUPER_ADMIN, active: true }).select("_id").lean();
    return await Promise.all(superAdmins.map((superAdmin) => notifyUser({
      once: true,
      userId: superAdmin._id,
      eventKey: `security:${audit._id}`,
      type: "SECURITY_ALERT",
      title: notificationText("Security alert"),
      message,
      path: `/super-admin/alerts?record=${audit._id}`,
      entityType: "AuditLog",
      entityId: audit._id
    })));
  } catch (error) {
    console.error("Security alert failed", error?.message || error);
    return [];
  }
}

// The Alerts page: every sensitive audit event, newest first.
export async function listSecurityAlerts(query = {}) {
  const kinds = query.kind && SECURITY_ALERT_KINDS.includes(query.kind) ? [query.kind] : SECURITY_ALERT_KINDS;
  const filter = securityAlertQuery(kinds);
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) filter.createdAt.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.record) filter._id = query.record;
  const { page, pageSize, skip } = parsePagination({ ...query, pageSize: query.pageSize || 25 });
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    AuditLog.countDocuments(filter)
  ]);
  return paginatedPayload(rows.map((row) => ({ ...row, kind: securityAlertKind(row) })), total, page, pageSize);
}

export async function countRecentSecurityAlerts(days = 7) {
  return AuditLog.countDocuments({ ...securityAlertQuery(), createdAt: { $gte: new Date(Date.now() - days * 86400000) } });
}
