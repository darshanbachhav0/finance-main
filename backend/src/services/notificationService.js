import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { activeApprovalStep } from "./approvalRuleService.js";

export async function notifyApprovalStep(request) {
  const step = activeApprovalStep(request);
  if (!step) return;
  const message = {
    eventKey: `request:${request._id}:approval:${step.approvalLevel}`,
    type: "APPROVAL_PENDING", title: "Approval pending",
    message: `${request.requestNumber} is waiting for ${step.approvalLevel} approval.`,
    path: `/approvals?request=${request._id}`, entityType: "FinancialRequest", entityId: request._id
  };
  if (step.approverUser) return notifyUser({ ...message, userId: step.approverUser?._id || step.approverUser });
  return notifyRoles({ ...message, roles: [step.role], approvalLevel: step.approvalLevel,
    areas: step.approvalLevel === "AREA_DIRECTOR" ? [request.requesterArea || request.requestingArea] : undefined });
}

// A notification must open the exact record. Call sites that still pass a bare list path get
// the record appended from the notification's entity: /treasury filters to the CXP (or to the
// request's CXPs), and a bare /budget link - a request-level budget problem with no exception
// record to open - goes to the request itself, where the budget state and actions are shown.
export function recordLinkFor(path, entityType, entityId) {
  if (!path || !entityId || path.includes("?")) return path;
  const id = String(entityId?._id || entityId);
  if (path === "/treasury") {
    if (entityType === "AccountsPayable") return `/treasury?record=${id}`;
    if (entityType === "FinancialRequest") return `/treasury?request=${id}`;
  }
  if (path === "/budget") {
    if (entityType === "BudgetException") return `/budget?tab=exceptions&record=${id}`;
    if (entityType === "FinancialRequest") return `/requests/${id}`;
  }
  return path;
}

export async function notifyUser({ userId, eventKey, type, title, message, path: requestedPath, entityType, entityId }) {
  if (!userId) return null;
  const path = recordLinkFor(requestedPath, entityType, entityId);
  return Notification.findOneAndUpdate(
    { user: userId, eventKey },
    // A re-sent notification (same event key, e.g. an approval that comes back to
    // the same approver after a resubmission) must reach the bell again as unread
    // with its current wording, not stay hidden under an old read timestamp.
    {
      $setOnInsert: { user: userId, eventKey, entityType, entityId },
      $set: { ...Object.fromEntries(Object.entries({ type, title, message, path }).filter(([, value]) => value !== undefined)), resolvedAt: null },
      $unset: { readAt: 1 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function notifyRoles({ roles, eventKey, type, title, message, path, entityType, entityId, approvalLevel, areas }) {
  const query = { active: true, role: { $in: roles } };
  if (approvalLevel) query.approvalLevel = approvalLevel;
  if (areas?.length) query.$or = [{ area: { $in: areas } }, { approvalAreas: { $in: [...areas, "*"] } }];
  const users = await User.find(query).select("_id");
  return Promise.all(users.map((user) => notifyUser({ userId: user._id, eventKey, type, title, message, path, entityType, entityId })));
}

// Closes every open approval task and SLA alert of a request (e.g. on withdrawal).
export async function resolveApprovalNotifications(requestId) {
  return Notification.updateMany(
    { entityType: "FinancialRequest", entityId: requestId, type: { $in: ["APPROVAL_PENDING", "SLA_DUE_SOON", "SLA_OVERDUE", "SLA_ESCALATION"] }, resolvedAt: null },
    { $set: { resolvedAt: new Date() } }
  );
}

export async function resolveNotification(eventKey) {
  return Notification.updateMany({ eventKey, resolvedAt: null }, { $set: { resolvedAt: new Date() } });
}

export async function listUserNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  const query = { user: userId, resolvedAt: null };
  if (unreadOnly) query.readAt = null;
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 50));
  return Notification.find(query).sort({ readAt: 1, createdAt: -1 }).limit(pageSize);
}

export async function countUnreadNotifications(userId) {
  return Notification.countDocuments({ user: userId, resolvedAt: null, readAt: null });
}

export async function markNotificationRead(id, userId) {
  return Notification.findOneAndUpdate({ _id: id, user: userId }, { $set: { readAt: new Date() } }, { new: true });
}

export async function markAllNotificationsRead(userId) {
  return Notification.updateMany({ user: userId, readAt: null, resolvedAt: null }, { $set: { readAt: new Date() } });
}
