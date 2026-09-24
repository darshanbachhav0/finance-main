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

export async function notifyUser({ userId, eventKey, type, title, message, path, entityType, entityId }) {
  if (!userId) return null;
  return Notification.findOneAndUpdate(
    { user: userId, eventKey },
    {
      $setOnInsert: { user: userId, eventKey, type, title, message, path, entityType, entityId },
      $set: { resolvedAt: null }
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
