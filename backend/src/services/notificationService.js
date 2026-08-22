import Notification from "../models/Notification.js";
import User from "../models/User.js";

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
  return Notification.find(query).sort({ createdAt: -1 }).limit(Math.min(100, Number(limit) || 50));
}

export async function markNotificationRead(id, userId) {
  return Notification.findOneAndUpdate({ _id: id, user: userId }, { $set: { readAt: new Date() } }, { new: true });
}

export async function markAllNotificationsRead(userId) {
  return Notification.updateMany({ user: userId, readAt: null, resolvedAt: null }, { $set: { readAt: new Date() } });
}

