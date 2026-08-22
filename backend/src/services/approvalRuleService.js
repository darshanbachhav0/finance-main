import ApprovalRule from "../models/ApprovalRule.js";
import { APPROVAL_STAGES, DEFAULT_APPROVAL_SLA_HOURS, FLOW_TYPE, ROLES } from "../utils/constants.js";

const defaultRoute = Object.freeze([
  {
    name: "Default Area Director approval",
    approvalLevel: APPROVAL_STAGES.AREA_DIRECTOR,
    role: ROLES.APPROVER,
    sequence: 1,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true
  },
  {
    name: "Default Vice Rector approval",
    approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
    role: ROLES.APPROVER,
    sequence: 2,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true
  }
]);

function dueDate(hours, startedAt = new Date()) {
  return new Date(startedAt.getTime() + Number(hours || DEFAULT_APPROVAL_SLA_HOURS) * 60 * 60 * 1000);
}

export async function resolveApprovalRoute(request) {
  const area = request.requesterArea || request.requestingArea || "General";
  const amount = Number(request.totalPENEquivalent ?? request.penEquivalent ?? request.totalAmount ?? 0);
  const rules = await ApprovalRule.find({
    active: true,
    area: { $in: ["*", area] },
    requestType: { $in: ["*", request.requestType] },
    flowType: { $in: ["*", request.flowType || FLOW_TYPE.A1] },
    amountFrom: { $lte: amount },
    $or: [{ amountTo: { $exists: false } }, { amountTo: null }, { amountTo: { $gte: amount } }]
  }).sort({ sequence: 1, area: -1, requestType: -1 });
  if (rules.length) {
    const exactFlowRules = rules.filter((rule) => rule.flowType === request.flowType);
    if (exactFlowRules.length) return exactFlowRules;
    // Track B is intentionally not allowed to inherit a slow wildcard route.
    // It must use an explicitly configured B route or the four-hour express default.
    if (request.flowType !== FLOW_TYPE.B) return rules;
  }
  if (request.flowType === FLOW_TYPE.B) {
    return [{ ...defaultRoute[0], name: "Express direct-payment approval", slaHours: 4 }];
  }
  return defaultRoute;
}

export async function initializeApprovalRoute(request) {
  const rules = await resolveApprovalRoute(request);
  const startedAt = new Date();
  request.approvalRouteSnapshot = rules.map((rule, index) => ({
    rule: rule._id,
    approvalLevel: rule.approvalLevel,
    role: rule.role,
    sequence: rule.sequence,
    slaHours: rule.slaHours,
    required: rule.required !== false,
    status: rule.required === false ? "SKIPPED" : "PENDING",
    startedAt: index === 0 && rule.required !== false ? startedAt : undefined,
    dueAt: index === 0 && rule.required !== false ? dueDate(rule.slaHours, startedAt) : undefined
  }));
  const first = activeApprovalStep(request);
  request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
  request.approvalDueAt = first?.dueAt || null;
  return request.approvalRouteSnapshot;
}

export function activeApprovalStep(request) {
  return [...(request.approvalRouteSnapshot || [])]
    .sort((a, b) => a.sequence - b.sequence)
    .find((step) => step.required !== false && step.status === "PENDING");
}

export function advanceApprovalRoute(request, userId) {
  const current = activeApprovalStep(request);
  if (!current) return { current: null, next: null, complete: true };
  const completedAt = new Date();
  current.status = "APPROVED";
  current.completedAt = completedAt;
  current.completedBy = userId;
  const next = activeApprovalStep(request);
  if (next) {
    next.startedAt = completedAt;
    next.dueAt = dueDate(next.slaHours, completedAt);
    request.approvalStage = next.approvalLevel;
    request.approvalDueAt = next.dueAt;
  } else {
    request.approvalStage = APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = null;
  }
  return { current, next, complete: !next };
}

export function stopApprovalRoute(request, status) {
  const current = activeApprovalStep(request);
  if (current) {
    current.status = status;
    current.completedAt = new Date();
  }
  request.approvalDueAt = null;
  return current;
}

export function slaStatus(stepOrRequest, now = new Date()) {
  const dueAt = stepOrRequest?.dueAt || stepOrRequest?.approvalDueAt;
  if (!dueAt) return { severity: "LOW", overdue: false, remainingMs: null };
  const remainingMs = new Date(dueAt).getTime() - now.getTime();
  const overdue = remainingMs < 0;
  const hours = remainingMs / (60 * 60 * 1000);
  const severity = overdue ? "OVERDUE" : hours <= 4 ? "HIGH" : hours <= 12 ? "MEDIUM" : "LOW";
  return { severity, overdue, remainingMs, dueAt };
}

