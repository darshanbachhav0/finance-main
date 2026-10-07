import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { activeApprovalStep } from "./approvalRuleService.js";

// Notification copy is a template with named placeholders plus its params, e.g.
// notificationText("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber, approvalLevel }).
// The interpolated English text is stored in title/message for any reader that
// shows them as-is; the template (titleKey/messageKey) and params let the UI
// translate the template first and then fill it in. Always pass a string literal
// template: the frontend test scans these calls for missing Spanish entries.
export function notificationText(template, params = {}) {
  const values = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, value === undefined || value === null ? "" : String(value)]));
  return { key: template, params: values, text: template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(values, name) ? values[name] : match)) };
}

// title/message may be a notificationText() result or a plain string (legacy callers).
export function notificationFields({ title, message }) {
  const copy = (value) => (value && typeof value === "object" ? value : { text: value, key: undefined, params: {} });
  const heading = copy(title);
  const body = copy(message);
  const fields = { title: heading.text, message: body.text };
  if (heading.key) fields.titleKey = heading.key;
  if (body.key) fields.messageKey = body.key;
  if (heading.key || body.key) fields.params = { ...heading.params, ...body.params };
  return fields;
}

export async function notifyApprovalStep(request) {
  const step = activeApprovalStep(request);
  if (!step) return;
  const message = {
    eventKey: `request:${request._id}:approval:${step.approvalLevel}`,
    type: "APPROVAL_PENDING", title: notificationText("Approval pending"),
    message: step.coveringForSnapshot?.name
      ? notificationText("{requestNumber} is waiting for your approval on behalf of {name}.", { requestNumber: request.requestNumber, name: step.coveringForSnapshot.name })
      : notificationText("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber: request.requestNumber, approvalLevel: step.approvalLevel }),
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

export async function notifyUser({ userId, eventKey, type, title, message, path: requestedPath, entityType, entityId, once = false }) {
  if (!userId) return null;
  const path = recordLinkFor(requestedPath, entityType, entityId);
  const copy = notificationFields({ title, message });
  if (once) return Notification.findOneAndUpdate({ user: userId, eventKey }, {
    $setOnInsert: { user: userId, eventKey, type, ...copy, path, entityType, entityId }
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  // Re-sent plain-string copy must not keep a previous template (it would render stale text).
  const staleKeys = {};
  if (copy.title !== undefined && !copy.titleKey) staleKeys.titleKey = 1;
  if (copy.message !== undefined && !copy.messageKey) staleKeys.messageKey = 1;
  if (staleKeys.titleKey && staleKeys.messageKey) staleKeys.params = 1;
  return Notification.findOneAndUpdate(
    { user: userId, eventKey },
    // A re-sent notification (same event key, e.g. an approval that comes back to
    // the same approver after a resubmission) must reach the bell again as unread
    // with its current wording, not stay hidden under an old read timestamp.
    {
      $setOnInsert: { user: userId, eventKey, entityType, entityId },
      $set: { ...Object.fromEntries(Object.entries({ type, ...copy, path }).filter(([, value]) => value !== undefined)), resolvedAt: null },
      $unset: { readAt: 1, ...staleKeys }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function notifyRoles({ once = false, roles, eventKey, type, title, message, path, entityType, entityId, approvalLevel, areas }) {
  const query = { active: true, role: { $in: roles } };
  if (approvalLevel) query.approvalLevel = approvalLevel;
  if (areas?.length) query.$or = [{ area: { $in: areas } }, { approvalAreas: { $in: [...areas, "*"] } }];
  const users = await User.find(query).select("_id");
  return Promise.all(users.map((user) => notifyUser({ once, userId: user._id, eventKey, type, title, message, path, entityType, entityId })));
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

// Closes every open task and alert of a request (e.g. when it is voided): nothing about it is
// actionable any more.
export async function resolveRequestNotifications(requestId) {
  return Notification.updateMany(
    { resolvedAt: null, $or: [{ entityType: "FinancialRequest", entityId: requestId }, { eventKey: { $regex: `^request:${String(requestId)}:` } }] },
    { $set: { resolvedAt: new Date() } }
  );
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

// "Mark done": the owner clears one notification from their bell. It only hides
// the alert — the underlying task (approval, payment…) is unaffected and stays in
// its workspace, and a re-sent notification for the same event comes back unread.
export async function dismissNotification(id, userId) {
  const now = new Date();
  return Notification.findOneAndUpdate(
    { _id: id, user: userId },
    [{ $set: { readAt: { $ifNull: ["$readAt", now] }, resolvedAt: { $ifNull: ["$resolvedAt", now] } } }],
    { new: true }
  );
}

export async function markAllNotificationsRead(userId) {
  return Notification.updateMany({ user: userId, readAt: null, resolvedAt: null }, { $set: { readAt: new Date() } });
}
