import FinancialRequest from "../models/FinancialRequest.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { activeApprovalStep, nearestAvailableSupervisor } from "./approvalRuleService.js";
import { allowedRequestActions } from "./requestActionPolicy.js";
import { classifyApprovalSla, escalationCandidateCutoff, isApprovalEscalated, slaConfiguration } from "./slaPolicy.js";
import { recordAudit } from "./auditService.js";
import { notificationFields, notificationText } from "./notificationService.js";

export const SLA_TYPES = ["SLA_DUE_SOON", "SLA_OVERDUE", "SLA_ESCALATION"];
const ACTIVE_STATUSES = ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR"];
const titles = { SLA_DUE_SOON: notificationText("Approval due soon"), SLA_OVERDUE: notificationText("Approval overdue"), SLA_ESCALATION: notificationText("Approval escalated") };

// Requests matching `query` whose approval (approvalDueAt) has escalated under the working-day
// rule the SLA worker uses. Dashboard and management-portal counters share this.
export async function countEscalatedApprovals(query = {}, { now = new Date(), config = slaConfiguration() } = {}) {
  const candidates = await FinancialRequest.find({ $and: [query, { approvalDueAt: { $lte: escalationCandidateCutoff(now, config) } }] }).select("approvalDueAt").lean();
  return candidates.filter((request) => isApprovalEscalated(request.approvalDueAt, now, config)).length;
}

export function approvalSlaCycle(request) {
  if (!ACTIVE_STATUSES.includes(request.status) || request.approvalStage === "COMPLETE") return null;
  const step = activeApprovalStep(request);
  if (request.approvalRouteSnapshot?.length && !step) return null;
  const dueAt = step?.dueAt || request.approvalDueAt;
  if (!dueAt || !Number.isFinite(new Date(dueAt).getTime())) return null;
  const stage = step?.approvalLevel || request.approvalStage;
  return { dueAt, stage, key: `sla:${request._id}:${step?._id || stage}:${new Date(dueAt).toISOString()}:${step?.startedAt ? new Date(step.startedAt).toISOString() : "legacy"}` };
}

// Idempotent delivery: one notification per user and SLA event; a retry or a
// second worker replica never duplicates it or resets its read state.
async function deliverOnce({ userId, eventKey, type, title, message, request }) {
  try {
    const result = await Notification.updateOne({ user: userId, eventKey }, { $setOnInsert: {
      user: userId, eventKey, type, ...notificationFields({ title, message }),
      path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id
    } }, { upsert: true });
    return result.upsertedCount || 0;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return 0;
  }
}

// Escalation goes up the organization, consistent with approver absence: to each
// current approver's own nearest available jefe (inactive / on-leave managers
// skipped). A manager-chain step escalates from its assigned approver. Management
// is only the fallback when no approver has anyone above them.
async function escalationRecipients(request, approvers, users) {
  const step = activeApprovalStep(request);
  const requesterId = request.requester || request.solicitor;
  const sources = step?.approverUser ? [step.approverUser] : approvers.map(user => user._id);
  const targets = new Map();
  for (const source of sources) {
    try {
      const { approver } = await nearestAvailableSupervisor(source, { exclude: [requesterId] });
      if (approver) targets.set(String(approver._id), approver);
    } catch { /* A broken roster must not stop the scan; the fallback below applies. */ }
  }
  if (targets.size) return [...targets.values()];
  return users.filter(user => user.role === "Management");
}

export async function checkApprovalSlas({ now = new Date(), config = slaConfiguration() } = {}) {
  const assigned = await FinancialRequest.distinct("approvalRouteSnapshot.approverUser", { status: { $in: ACTIVE_STATUSES } });
  const users = await User.find({ active: true, $or: [{ role: { $in: ["AreaDirector", "ViceRector", "Management", "Admin"] } }, { _id: { $in: assigned } }] }).lean();
  const liveEvents = new Map();
  const summary = { checked: 0, delivered: 0, escalations: 0 };
  // Stream requests so the scan does not load the whole approval queue into memory.
  const cursor = FinancialRequest.find({ status: { $in: ACTIVE_STATUSES }, approvalStage: { $ne: "COMPLETE" } }).lean().cursor();
  for await (const candidate of cursor) {
    // Re-read before delivery: a decision or route change may have occurred during the scan.
    const request = await FinancialRequest.findById(candidate._id).lean();
    if (!request) continue;
    const cycle = approvalSlaCycle(request);
    if (!cycle) continue;
    summary.checked++;
    const { alert } = classifyApprovalSla(cycle.dueAt, now, config);
    if (!alert) continue;
    const eventKey = `${cycle.key}:${alert}`;
    const approvers = users.filter(user => allowedRequestActions(request, user).includes("APPROVE") && (user.role !== "Admin" || activeApprovalStep(request)?.role === "Admin"));
    const escalationTargets = alert === "SLA_ESCALATION" ? await escalationRecipients(request, approvers, users) : [];
    const deliveries = [
      ...approvers.map(user => ({ user, title: titles[alert] })),
      ...escalationTargets.filter(target => !approvers.some(user => String(user._id) === String(target._id))).map(user => ({ user, title: notificationText("Approval escalated to you") }))
    ];
    liveEvents.set(eventKey, new Set(deliveries.map(({ user }) => String(user._id))));
    const message = notificationText("{requestNumber}: {stage}, due {dueAt}.", { requestNumber: request.requestNumber, stage: cycle.stage, dueAt: new Date(cycle.dueAt).toISOString() });
    for (const { user, title } of deliveries) summary.delivered += await deliverOnce({ userId: user._id, eventKey, type: alert, title, message, request });
    // The requester learns their approval is overdue (one alert per step cycle).
    const requesterId = request.requester || request.solicitor;
    if (requesterId && alert !== "SLA_DUE_SOON") {
      const requesterKey = `${cycle.key}:REQUESTER_OVERDUE`;
      liveEvents.set(requesterKey, new Set([String(requesterId)]));
      summary.delivered += await deliverOnce({ userId: requesterId, eventKey: requesterKey, type: "SLA_OVERDUE", title: notificationText("Your request's approval is overdue"), message: notificationText("{requestNumber} is still waiting for {stage}; it was due {dueAt}.", { requestNumber: request.requestNumber, stage: cycle.stage, dueAt: new Date(cycle.dueAt).toISOString() }), request });
    }
    const recipients = deliveries.map(({ user }) => user);
    if (alert === "SLA_ESCALATION") {
      // Immutable unique audit key handles retries and concurrent worker replicas.
      if (!(await AuditLog.exists({ eventKey }))) {
        try {
          await recordAudit({ entityType: "FinancialRequest", entity: request, action: alert,
            user: { name: "SLA worker", role: "SYSTEM" }, module: "SLA", eventKey,
            comments: `Approval overdue by at least ${config.escalationWorkingDays || Math.ceil((config.escalationHours || 24) / 24)} working day(s); escalated to the approver's jefe.`,
            oldValues: { status: request.status, approvalStage: cycle.stage, dueAt: cycle.dueAt },
            newValues: { status: request.status, approvalStage: cycle.stage, dueAt: cycle.dueAt, recipients: recipients.map(user => user._id) } });
          summary.escalations++;
        } catch (error) { if (error.code !== 11000) throw error; }
      }
    }
  }
  // Resolve old stages, completed/observed/rejected requests and superseded severity alerts.
  const notifications = Notification.find({ type: { $in: SLA_TYPES }, resolvedAt: null }).select("eventKey user").lean().cursor();
  for await (const notification of notifications) {
    if (!liveEvents.get(notification.eventKey)?.has(String(notification.user))) {
      await Notification.updateOne({ _id: notification._id, resolvedAt: null }, { $set: { resolvedAt: now } });
    }
  }
  return summary;
}
