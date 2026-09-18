import FinancialRequest from "../models/FinancialRequest.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { activeApprovalStep } from "./approvalRuleService.js";
import { allowedRequestActions } from "./requestActionPolicy.js";
import { classifyApprovalSla, slaConfiguration } from "./slaPolicy.js";
import { recordAudit } from "./auditService.js";

export const SLA_TYPES = ["SLA_DUE_SOON", "SLA_OVERDUE", "SLA_ESCALATION"];
const ACTIVE_STATUSES = ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR"];
const titles = { SLA_DUE_SOON: "Approval due soon", SLA_OVERDUE: "Approval overdue", SLA_ESCALATION: "Approval escalated to Management" };

export function approvalSlaCycle(request) {
  if (!ACTIVE_STATUSES.includes(request.status) || request.approvalStage === "COMPLETE") return null;
  const step = activeApprovalStep(request);
  if (request.approvalRouteSnapshot?.length && !step) return null;
  const dueAt = step?.dueAt || request.approvalDueAt;
  if (!dueAt || !Number.isFinite(new Date(dueAt).getTime())) return null;
  const stage = step?.approvalLevel || request.approvalStage;
  return { dueAt, stage, key: `sla:${request._id}:${step?._id || stage}:${new Date(dueAt).toISOString()}:${step?.startedAt ? new Date(step.startedAt).toISOString() : "legacy"}` };
}

export async function checkApprovalSlas({ now = new Date(), config = slaConfiguration() } = {}) {
  const users = await User.find({ active: true, role: { $in: ["Approver", "Management", "Admin"] } }).lean();
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
    const recipients = users.filter(user => (allowedRequestActions(request, user).includes("APPROVE") && (user.role !== "Admin" || activeApprovalStep(request)?.role === "Admin"))
      || (alert === "SLA_ESCALATION" && user.role === "Management"));
    liveEvents.set(eventKey, new Set(recipients.map(user => String(user._id))));
    for (const user of recipients) {
      try {
        const result = await Notification.updateOne({ user: user._id, eventKey }, { $setOnInsert: {
          user: user._id, eventKey, type: alert, title: titles[alert],
          message: `${request.requestNumber}: ${cycle.stage}, due ${new Date(cycle.dueAt).toISOString()}.`,
          path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id
        } }, { upsert: true });
        summary.delivered += result.upsertedCount || 0;
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    if (alert === "SLA_ESCALATION") {
      // Immutable unique audit key handles retries and concurrent worker replicas.
      if (!(await AuditLog.exists({ eventKey }))) {
        try {
          await recordAudit({ entityType: "FinancialRequest", entity: request, action: alert,
            user: { name: "SLA worker", role: "SYSTEM" }, module: "SLA", eventKey,
            comments: `Approval overdue by at least ${config.escalationHours} hours.`,
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
