import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { availableSubstituteOf, nearestAvailableSupervisor } from "./approvalRuleService.js";
import { reassignPendingApprovalsFor } from "./approvalService.js";
import { recordAudit } from "./auditService.js";
import { notificationText, notifyUser } from "./notificationService.js";
import { APPROVAL_ROUTING_MODE, REQUEST_STATUS } from "../utils/constants.js";

const SYSTEM_ACTOR = Object.freeze({ name: "System", role: "SYSTEM" });
const ACTIVE_APPROVAL_STATUSES = [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED];
const person = (user) => (user ? { _id: user._id, name: user.name, jobTitle: user.jobTitle || "" } : null);

// "On leave until" is the last day of leave, picked as a calendar date (stored as UTC midnight).
export const leaveLastDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

// Who takes this person's approvals while they are away: their substitute when one is set and
// available, otherwise their nearest available jefe; null when nobody can.
export async function leaveCoverage(user) {
  const substitute = await availableSubstituteOf(user, { exclude: [user._id] });
  if (substitute) return { via: "SUBSTITUTE", person: person(substitute) };
  try {
    const { approver } = await nearestAvailableSupervisor(user._id, { exclude: [user._id] });
    return approver ? { via: "SUPERVISOR", person: person(approver) } : { via: null, person: null };
  } catch {
    return { via: null, person: null };
  }
}

// The leave panel: status, who covers, what is waiting on this person and whom they cover.
export async function leaveSummary(userId) {
  await endExpiredLeaves({ userIds: [userId] });
  const user = await User.findById(userId).select("name jobTitle active onLeave leaveUntil leaveStartedAt jefe substitute").populate("substitute", "name jobTitle").lean();
  const coverage = await leaveCoverage({ ...user, substitute: user.substitute?._id || null });
  const chainStep = (match) => ({ status: { $in: ACTIVE_APPROVAL_STATUSES }, approvalRouteSnapshot: { $elemMatch: { status: "PENDING", source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN, ...match } } });
  const [waitingOnMe, coveredSteps] = await Promise.all([
    FinancialRequest.countDocuments(chainStep({ approverUser: user._id })),
    FinancialRequest.find(chainStep({ approverUser: user._id, coveringFor: { $ne: null } })).select("approvalRouteSnapshot").lean()
  ]);
  const covering = new Map();
  for (const request of coveredSteps) {
    const step = request.approvalRouteSnapshot.find((item) => item.status === "PENDING" && String(item.approverUser) === String(user._id) && item.coveringFor);
    if (!step) continue;
    const key = String(step.coveringFor);
    covering.set(key, { _id: step.coveringFor, name: step.coveringForSnapshot?.name || "", count: (covering.get(key)?.count || 0) + 1 });
  }
  return {
    onLeave: Boolean(user.onLeave),
    leaveStartedAt: user.leaveStartedAt || null,
    leaveUntil: leaveLastDay(user.leaveUntil),
    substitute: person(user.substitute),
    coverage,
    pendingApprovals: waitingOnMe,
    covering: [...covering.values()]
  };
}

// Tells the substitute when they start covering someone, and when that person is back.
export async function notifySubstituteOfLeave(user, { started }) {
  if (!user.substitute) return;
  const until = leaveLastDay(user.leaveUntil);
  await notifyUser({
    userId: user.substitute?._id || user.substitute,
    eventKey: `leave:${user._id}:${started ? "start" : "end"}:${new Date(user.leaveStartedAt || Date.now()).getTime()}`,
    type: started ? "LEAVE_COVERAGE_STARTED" : "LEAVE_COVERAGE_ENDED",
    title: started ? notificationText("You are covering approvals") : notificationText("Coverage ended"),
    message: started
      ? (until
        ? notificationText("{name} is on leave until {until}. Their approvals come to you meanwhile.", { name: user.name, until })
        : notificationText("{name} is on leave. Their approvals come to you meanwhile.", { name: user.name }))
      : notificationText("{name} is back. The approvals you were holding for them have returned to them.", { name: user.name }),
    path: "/approvals",
    entityType: "User",
    entityId: user._id
  });
}

// A leave ends by itself once its last day has passed: the person is available again and the
// approvals held for them come back. Runs on the SLA scan and when the person opens the app.
export async function endExpiredLeaves({ now = new Date(), userIds } = {}) {
  const query = { onLeave: true, leaveUntil: { $ne: null } };
  if (userIds) query._id = { $in: userIds };
  const today = limaDateKey(now);
  const expired = (await User.find(query)).filter((user) => leaveLastDay(user.leaveUntil) < today);
  for (const user of expired) {
    const oldValues = { onLeave: true, leaveUntil: user.leaveUntil, leaveStartedAt: user.leaveStartedAt };
    user.onLeave = false;
    user.leaveUntil = undefined;
    user.leaveStartedAt = undefined;
    await user.save();
    await recordAudit({ entityType: "User", entity: user, action: "LEAVE_ENDED", user: SYSTEM_ACTOR, module: "USER_ADMIN", comments: `Leave ended automatically after ${leaveLastDay(oldValues.leaveUntil)}.`, oldValues, newValues: { onLeave: false } });
    await reassignPendingApprovalsFor(user._id, { actor: SYSTEM_ACTOR, reason: "RETURNED" });
    await notifySubstituteOfLeave({ ...user.toObject(), leaveStartedAt: oldValues.leaveStartedAt }, { started: false });
    await notifyUser({
      userId: user._id,
      eventKey: `leave:${user._id}:auto-end:${leaveLastDay(oldValues.leaveUntil)}`,
      type: "LEAVE_ENDED",
      title: notificationText("Welcome back"),
      message: notificationText("Your leave ended after {until}. Your approvals come to you again.", { until: leaveLastDay(oldValues.leaveUntil) }),
      path: "/approvals",
      entityType: "User",
      entityId: user._id
    });
  }
  return { ended: expired.length };
}
