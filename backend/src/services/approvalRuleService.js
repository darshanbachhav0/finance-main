import ApprovalRule from "../models/ApprovalRule.js";
import User from "../models/User.js";
import { classifyApprovalSla } from "./slaPolicy.js";
import { AppError } from "../utils/AppError.js";
import {
  APPROVAL_ROUTING_MODE,
  APPROVAL_STAGES,
  DEFAULT_APPROVAL_SLA_HOURS,
  ERROR_CODES,
  FLOW_TYPE,
  MAX_APPROVAL_CHAIN_DEPTH,
  ROLES
} from "../utils/constants.js";

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

function routeValue(rule, overrides = {}) {
  return { ...(rule?.toObject ? rule.toObject() : rule), ...overrides };
}

export function defaultApprovalRouteForFlow(flowType) {
  if (flowType === FLOW_TYPE.B) return [
    { ...defaultRoute[0], name: "Track B Area Director approval", sequence: 1, slaHours: 4 },
    { ...defaultRoute[1], name: "Track B Vice Rector approval", sequence: 2, slaHours: 4 }
  ];
  return defaultRoute.map((rule) => ({ ...rule }));
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
    if (exactFlowRules.length) {
      if (request.flowType !== FLOW_TYPE.B) return exactFlowRules;
      const director = exactFlowRules.find((rule) => rule.approvalLevel === APPROVAL_STAGES.AREA_DIRECTOR) || { ...defaultRoute[0], slaHours: 4 };
      const viceRector = exactFlowRules.find((rule) => rule.approvalLevel === APPROVAL_STAGES.VICE_RECTOR) || { ...defaultRoute[1], name: "Track B Vice Rector approval", slaHours: 4 };
      return [routeValue(director, { sequence: 1 }), routeValue(viceRector, { sequence: 2 })];
    }
    // Track B uses only an explicitly configured B route; wildcard rules may
    // contain unrelated higher-value stages.
    if (request.flowType !== FLOW_TYPE.B) return rules;
  }
  if (request.flowType === FLOW_TYPE.B) {
    return defaultApprovalRouteForFlow(FLOW_TYPE.B);
  }
  return defaultApprovalRouteForFlow(request.flowType);
}

function chainStepLabel(user) {
  return user?.jobTitle ? `${user.jobTitle} (${user.name})` : `Jefe: ${user?.name || "?"}`;
}

function approverSnapshotOf(user) {
  return { name: user?.name, dni: user?.dni, jobTitle: user?.jobTitle };
}

// The manager chain is resolved by identity, not by role/area membership: a
// request's next approver is always the requester's actual jefe. Requesters
// without a jefe (not yet imported from the org roster, or admin-created
// accounts) fall back to the legacy rule-based route untouched.
export async function resolveManagerChainStart(request) {
  const requesterId = request.requester || request.solicitor;
  if (!requesterId) return null;
  const requester = await User.findById(requesterId).select("jefe name dni jobTitle").lean();
  if (!requester?.jefe) return null;
  const jefe = await User.findById(requester.jefe).select("name dni jobTitle active").lean();
  if (!jefe || jefe.active === false) return null;
  const startedAt = new Date();
  return [{
    approverUser: jefe._id,
    approverSnapshot: approverSnapshotOf(jefe),
    approvalLevel: chainStepLabel(jefe),
    role: ROLES.SOLICITOR,
    sequence: 1,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true,
    status: "PENDING",
    startedAt,
    dueAt: dueDate(DEFAULT_APPROVAL_SLA_HOURS, startedAt),
    source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN
  }];
}

export async function initializeApprovalRoute(request) {
  const existing = [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence);
  if (existing.length) {
    // Resubmission after a return/observation re-reviews the whole historical
    // route from its first step, exactly as the rule-based path always has —
    // every step's rule/approverUser/source is preserved, only its run state
    // (status/timestamps) resets.
    request.approvalRoutingMode ||= existing[0]?.source || APPROVAL_ROUTING_MODE.RULE_BASED;
    const startedAt = new Date();
    request.approvalRouteSnapshot = existing.map((step, index) => ({
      rule: step.rule?._id || step.rule,
      approvalLevel: step.approvalLevel,
      role: step.role,
      sequence: step.sequence,
      slaHours: step.slaHours,
      required: step.required !== false,
      status: step.required === false ? "SKIPPED" : "PENDING",
      startedAt: index === 0 && step.required !== false ? startedAt : undefined,
      dueAt: index === 0 && step.required !== false ? dueDate(step.slaHours, startedAt) : undefined,
      completedAt: undefined,
      completedBy: undefined,
      approverUser: step.approverUser?._id || step.approverUser,
      approverSnapshot: step.approverSnapshot,
      source: step.source || APPROVAL_ROUTING_MODE.RULE_BASED
    }));
    const first = activeApprovalStep(request);
    request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = first?.dueAt || null;
    return request.approvalRouteSnapshot;
  }

  const chainStart = await resolveManagerChainStart(request);
  if (chainStart) {
    request.approvalRoutingMode = APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
    request.approvalRouteSnapshot = chainStart;
    const first = activeApprovalStep(request);
    request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = first?.dueAt || null;
    return request.approvalRouteSnapshot;
  }

  request.approvalRoutingMode = APPROVAL_ROUTING_MODE.RULE_BASED;
  const rules = await resolveApprovalRoute(request);
  const startedAt = new Date();
  request.approvalRouteSnapshot = rules.map((rule, index) => ({
    rule: rule.rule?._id || rule.rule || rule._id,
    approvalLevel: rule.approvalLevel,
    role: rule.role,
    sequence: rule.sequence,
    slaHours: rule.slaHours,
    required: rule.required !== false,
    status: rule.required === false ? "SKIPPED" : "PENDING",
    startedAt: index === 0 && rule.required !== false ? startedAt : undefined,
    dueAt: index === 0 && rule.required !== false ? dueDate(rule.slaHours, startedAt) : undefined,
    completedAt: undefined,
    completedBy: undefined,
    source: APPROVAL_ROUTING_MODE.RULE_BASED
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

// Unlike the rule-based route (precomputed in full at submission time), the
// manager chain is built one decision at a time: each jefe explicitly chooses
// to forward to their own jefe or to finalize here. This mirrors how a real
// chain of command actually decides escalation, rather than assuming every
// request must climb to the top of the org.
export async function appendNextChainStep(request, currentStep, decidingUser) {
  const decidingJefeId = decidingUser?.jefe;
  if (!decidingJefeId) {
    throw new AppError(422, "This approver has no manager to forward to; the decision must be final.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const jefe = await User.findById(decidingJefeId).select("name dni jobTitle active").lean();
  if (!jefe || jefe.active === false) {
    throw new AppError(422, "This approver's manager account is not available; the decision must be final.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const route = request.approvalRouteSnapshot || [];
  if (route.some((step) => step.approverUser && String(step.approverUser) === String(jefe._id))) {
    throw new AppError(409, "This approval chain would revisit an approver already in the route.", undefined, ERROR_CODES.CONFLICT);
  }
  if (route.length >= MAX_APPROVAL_CHAIN_DEPTH) {
    throw new AppError(409, "This approval chain has exceeded the maximum allowed depth.", { maxDepth: MAX_APPROVAL_CHAIN_DEPTH }, ERROR_CODES.CONFLICT);
  }

  const completedAt = new Date();
  currentStep.status = "APPROVED";
  currentStep.completedAt = completedAt;
  currentStep.completedBy = decidingUser._id;

  const nextStep = {
    approverUser: jefe._id,
    approverSnapshot: approverSnapshotOf(jefe),
    approvalLevel: chainStepLabel(jefe),
    role: ROLES.SOLICITOR,
    sequence: (currentStep.sequence || route.length) + 1,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true,
    status: "PENDING",
    startedAt: completedAt,
    dueAt: dueDate(DEFAULT_APPROVAL_SLA_HOURS, completedAt),
    source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN
  };
  request.approvalRouteSnapshot.push(nextStep);
  request.approvalStage = nextStep.approvalLevel;
  request.approvalDueAt = nextStep.dueAt;
  return { complete: false, next: nextStep };
}

export function finalizeChainApproval(request, currentStep, decidingUser) {
  currentStep.status = "APPROVED";
  currentStep.completedAt = new Date();
  currentStep.completedBy = decidingUser._id;
  request.approvalStage = APPROVAL_STAGES.COMPLETE;
  request.approvalDueAt = null;
  return { complete: true };
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
  return classifyApprovalSla(activeApprovalStep(stepOrRequest)?.dueAt || stepOrRequest?.dueAt || stepOrRequest?.approvalDueAt, now);
}
