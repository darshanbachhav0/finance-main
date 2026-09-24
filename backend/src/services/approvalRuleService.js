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

export async function resolveApprovalRoute(request, { configuredOnly = false } = {}) {
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
  if (configuredOnly && request.flowType !== FLOW_TYPE.B) return [];
  if (request.flowType === FLOW_TYPE.B) {
    return defaultApprovalRouteForFlow(FLOW_TYPE.B);
  }
  return defaultApprovalRouteForFlow(request.flowType);
}

function chainStepLabel(user) {
  return user?.jobTitle ? `${user.jobTitle} (${user.name})` : `Jefe: ${user?.name || "?"}`;
}

function approverSnapshotOf(user) {
  return { name: user?.name, jobTitle: user?.jobTitle };
}

// The manager chain is resolved by identity, not by role/area membership: a
// request's approval path is always the requester's real organizational chain
// (jefe, jefe's jefe, and so on). Requesters without a jefe (not yet imported
// from the org roster, or admin-created accounts) fall back to the legacy
// rule-based route untouched.
//
// The FULL chain, up to the organizational root (or MAX_APPROVAL_CHAIN_DEPTH,
// or the point a cycle would revisit an approver already in the chain — a
// data-entry error in the org roster, not a normal outcome), is resolved and
// snapshotted once, at submission time. Only the first step starts PENDING
// (actionable now); every further level is snapshotted as NOT_REACHED — its
// identity is already frozen and activates after the preceding required step.
// This makes the route stable against later organizational changes: forwarding
// resolves to the manager who was in place at submission time, never to
// whoever holds that position later.
export async function resolveManagerChain(request) {
  const requesterId = request.requester || request.solicitor;
  if (!requesterId) return null;
  const chain = [];
  const visited = new Set([String(requesterId?._id || requesterId)]);
  let currentUserId = requesterId;
  for (let level = 0; level < MAX_APPROVAL_CHAIN_DEPTH; level += 1) {
    const currentUser = await User.findById(currentUserId).select("jefe").lean();
    if (!currentUser?.jefe) break;
    const jefeId = String(currentUser.jefe);
    if (visited.has(jefeId)) throw new AppError(422, "The supervisor hierarchy contains a cycle. Administration must correct it before submission.");
    const jefe = await User.findById(jefeId).select("name jobTitle active jefe role approvalLevel").lean();
    if (!jefe || jefe.active === false || jefe.role === ROLES.MANAGEMENT_VIEWER) throw new AppError(422, "The assigned supervisor must be an active internal user. Administration must correct the hierarchy before submission.");
    visited.add(jefeId);
    chain.push(jefe);
    currentUserId = jefe._id;
  }
  if (!chain.length) return null;
  if (chain.length === MAX_APPROVAL_CHAIN_DEPTH && chain.at(-1).jefe) throw new AppError(422, "The supervisor hierarchy exceeds the supported depth. Review the organizational master.");
  const startedAt = new Date();
  return chain.map((jefe, index) => ({
    approverUser: jefe._id,
    approverSnapshot: approverSnapshotOf(jefe),
    approvalLevel: chainStepLabel(jefe),
    role: jefe.role,
    sequence: index + 1,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true,
    status: index === 0 ? "PENDING" : "NOT_REACHED",
    startedAt: index === 0 ? startedAt : undefined,
    dueAt: index === 0 ? dueDate(DEFAULT_APPROVAL_SLA_HOURS, startedAt) : undefined,
    source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN
  }));
}

export async function initializeApprovalRoute(request) {
  const existing = [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence);
  if (existing.length) {
    // Resubmission after a return/observation re-reviews the whole historical
    // route from its first step, exactly as the rule-based path always has —
    // every step's rule/approverUser/source is preserved, only its run state
    // (status/timestamps) resets. For a manager chain, "reset" means: step 1
    // becomes actionable again, and every other pre-determined level goes
    // back to NOT_REACHED (its frozen identity is kept, but any progress a
    // previous submission made escalating into it is cleared).
    const isChain = (existing[0]?.source || APPROVAL_ROUTING_MODE.RULE_BASED) === APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
    request.approvalRoutingMode ||= existing[0]?.source || APPROVAL_ROUTING_MODE.RULE_BASED;
    const startedAt = new Date();
    const firstRequiredIndex = existing.findIndex(step => step.required !== false);
    request.approvalRouteSnapshot = existing.map((step, index) => ({
      rule: step.rule?._id || step.rule,
      approvalLevel: step.approvalLevel,
      role: step.role,
      sequence: step.sequence,
      slaHours: step.slaHours,
      required: step.required !== false,
      status: step.required === false ? "SKIPPED" : index === firstRequiredIndex || !isChain ? "PENDING" : "NOT_REACHED",
      startedAt: index === firstRequiredIndex ? startedAt : undefined,
      dueAt: index === firstRequiredIndex ? dueDate(step.slaHours, startedAt) : undefined,
      completedAt: undefined,
      completedBy: undefined,
      approverUser: step.approverUser?._id || step.approverUser,
      approverSnapshot: step.approverSnapshot,
      source: step.source || APPROVAL_ROUTING_MODE.RULE_BASED
    }));
    const first = activeApprovalStep(request);
    if (first && !first.startedAt) {
      first.startedAt = startedAt;
      first.dueAt = dueDate(first.slaHours, startedAt);
    }
    request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = first?.dueAt || null;
    return request.approvalRouteSnapshot;
  }

  const chain = await resolveManagerChain(request);
  if (chain) {
    // Organizational identity never exempts a request from configured authority.
    // Keep policy stages after the frozen hierarchy unless that same authority
    // already appears as an assigned manager in the chain.
    const rules = await resolveApprovalRoute(request, { configuredOnly: true });
    for (const rule of rules.filter(rule => rule.required !== false)) {
      const matches = await User.exists({ _id: { $in: chain.map(step => step.approverUser) }, role: rule.role, approvalLevel: rule.approvalLevel });
      if (!matches) chain.push({ rule: rule._id, approvalLevel: rule.approvalLevel, role: rule.role, sequence: chain.length + 1, slaHours: rule.slaHours, required: true, status: "NOT_REACHED", source: APPROVAL_ROUTING_MODE.RULE_BASED });
    }
    request.approvalRoutingMode = APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
    request.approvalRouteSnapshot = chain;
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
  if (first && !first.startedAt) {
    first.startedAt = startedAt;
    first.dueAt = dueDate(first.slaHours, startedAt);
  }
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
  const next = [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence)
    .find(step => step.sequence > current.sequence && step.required !== false && ["PENDING", "NOT_REACHED"].includes(step.status));
  if (next) {
    next.status = "PENDING";
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

// The full chain was already resolved and frozen at submission time
// (resolveManagerChain). Forwarding never looks up a manager live — it only
// activates the next pre-determined, already-snapshotted level. This is what
// keeps an in-flight escalation immune to organizational changes that happen
// after submission.
export function activateNextChainStep(request, currentStep, decidingUser) {
  const route = [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence);
  const nextStep = route.find((step) => step.sequence > currentStep.sequence && step.required !== false && ["NOT_REACHED", "PENDING"].includes(step.status));
  if (!nextStep) {
    throw new AppError(422, "There is no further manager in this request's pre-determined approval chain; the decision must be final.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }

  const completedAt = new Date();
  currentStep.status = "APPROVED";
  currentStep.completedAt = completedAt;
  currentStep.completedBy = decidingUser._id;

  nextStep.status = "PENDING";
  nextStep.startedAt = completedAt;
  nextStep.dueAt = dueDate(nextStep.slaHours, completedAt);
  request.approvalStage = nextStep.approvalLevel;
  request.approvalDueAt = nextStep.dueAt;
  return { complete: false, next: nextStep };
}

export function finalizeChainApproval(request, currentStep, decidingUser) {
  if ((request.approvalRouteSnapshot || []).some(step => step.sequence > currentStep.sequence && step.required !== false && step.status !== "APPROVED")) {
    throw new AppError(409, "Required approvals remain in the frozen route. Approve and forward to the next stage.");
  }
  const completedAt = new Date();
  currentStep.status = "APPROVED";
  currentStep.completedAt = completedAt;
  currentStep.completedBy = decidingUser._id;
  // Only optional historical stages can remain; retain them as explicit skips.
  for (const step of request.approvalRouteSnapshot || []) {
    if (step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN && step.sequence > currentStep.sequence && step.status === "NOT_REACHED") {
      step.status = "SKIPPED";
      step.completedAt = completedAt;
    }
  }
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
