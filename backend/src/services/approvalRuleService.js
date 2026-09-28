import ApprovalRule from "../models/ApprovalRule.js";
import User from "../models/User.js";
import { approvalSlaWorkingDays, classifyApprovalSla } from "./slaPolicy.js";
import { addWorkingDays, nextWorkingDay } from "./businessCalendarService.js";
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
    role: ROLES.AREA_DIRECTOR,
    sequence: 1,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true
  },
  {
    name: "Default Vice Rector approval",
    approvalLevel: APPROVAL_STAGES.VICE_RECTOR,
    role: ROLES.VICE_RECTOR,
    sequence: 2,
    slaHours: DEFAULT_APPROVAL_SLA_HOURS,
    required: true
  }
]);

// SLA durations are expressed in working days: a step's slaHours is read as
// "24 per working day" (the historical 24h default is one working day). Sub-day SLAs
// (Track B's 4h express route) count elapsed hours but never land on a weekend or
// holiday. Both use the Peruvian working-day calendar.
export function approvalStepSlaHours() {
  return approvalSlaWorkingDays() * 24;
}

export function dueDate(hours, startedAt = new Date()) {
  const slaHours = Number(hours) > 0 ? Number(hours) : approvalStepSlaHours();
  if (slaHours >= 24) return addWorkingDays(startedAt, Math.ceil(slaHours / 24));
  return nextWorkingDay(new Date(nextWorkingDay(startedAt).getTime() + slaHours * 60 * 60 * 1000));
}

function routeValue(rule, overrides = {}) {
  return { ...(rule?.toObject ? rule.toObject() : rule), ...overrides };
}

export function defaultApprovalRouteForFlow(flowType) {
  if (flowType === FLOW_TYPE.B) return [
    { ...defaultRoute[0], name: "Track B Area Director approval", sequence: 1, slaHours: 4 },
    { ...defaultRoute[1], name: "Track B Vice Rector approval", sequence: 2, slaHours: 4 }
  ];
  return defaultRoute.map((rule) => ({ ...rule, slaHours: approvalStepSlaHours() }));
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

const idOf = (value) => String(value?._id || value || "");
const bySequence = (request) => [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence);
const OPEN_STEP_STATUSES = ["PENDING", "NOT_REACHED"];

// Someone can take an approval right now only while their account is active, they
// are not on leave, and they hold an internal role (ManagementViewer is read-only).
export function isAvailableApprover(user) {
  return Boolean(user) && user.active !== false && !user.onLeave && user.role !== ROLES.MANAGEMENT_VIEWER;
}

// Every supervisor above userId, nearest first: [jefe, jefe's jefe, ...]. A cycle
// or an over-deep hierarchy is a data-entry error in the org roster and is refused.
export async function supervisorChainOf(userId) {
  const chain = [];
  const visited = new Set([idOf(userId)]);
  let current = userId ? await User.findById(idOf(userId)).select("jefe").lean() : null;
  for (let level = 0; current?.jefe; level += 1) {
    if (level >= MAX_APPROVAL_CHAIN_DEPTH) throw new AppError(422, "The supervisor hierarchy exceeds the supported depth. Review the organizational master.");
    const jefeId = idOf(current.jefe);
    if (visited.has(jefeId)) throw new AppError(422, "The supervisor hierarchy contains a cycle. Administration must correct it before submission.");
    visited.add(jefeId);
    const jefe = await User.findById(jefeId).select("name jobTitle active onLeave jefe role approvalLevel").lean();
    if (!jefe) break;
    chain.push(jefe);
    current = jefe;
  }
  return chain;
}

// The nearest supervisor above userId who can act now. Inactive and on-leave
// managers are skipped going up, so an absence never strands a request.
export async function nearestAvailableSupervisor(userId, { exclude = [] } = {}) {
  const excluded = new Set(exclude.filter(Boolean).map(idOf));
  const chain = await supervisorChainOf(userId);
  const skipped = [];
  for (const jefe of chain) {
    if (isAvailableApprover(jefe) && !excluded.has(idOf(jefe._id))) return { approver: jefe, skipped, hasSupervisor: true };
    skipped.push(jefe);
  }
  return { approver: null, skipped, hasSupervisor: chain.length > 0 };
}

export function noAvailableApproverError(details) {
  return new AppError(
    422,
    "No supervisor is available to approve this request: every manager above you in the organizational roster is inactive or on leave. Contact the Admin to update the roster.",
    details,
    ERROR_CODES.APPROVAL_ROUTE_NOT_CONFIGURED
  );
}

function chainStep(jefe, { sequence, startedAt }) {
  const slaHours = approvalStepSlaHours();
  return {
    approverUser: jefe._id,
    approverSnapshot: approverSnapshotOf(jefe),
    approvalLevel: chainStepLabel(jefe),
    role: jefe.role,
    sequence,
    slaHours,
    required: true,
    status: "PENDING",
    startedAt,
    dueAt: dueDate(slaHours, startedAt),
    source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN
  };
}

// The manager chain is resolved by identity, not by role/area membership: a
// request's approval path is always the requester's real organizational chain
// (jefe, jefe's jefe, and so on). Requesters without a jefe (not yet imported
// from the org roster, or admin-created accounts) fall back to the rule-based
// route untouched.
//
// Flexible chain: only the first available jefe is placed on the route at
// submission. At every chain step the approver either finalizes the approval
// (the chain is complete) or sends it to their own jefe, and only then is that
// next level added to the route - resolved at that moment, skipping inactive and
// on-leave managers. The whole hierarchy is still walked at submission, so a
// cyclical or over-deep roster is refused up front.
export async function resolveManagerChain(request) {
  const requesterId = request.requester || request.solicitor;
  if (!requesterId) return null;
  const { approver, skipped, hasSupervisor } = await nearestAvailableSupervisor(requesterId, { exclude: [requesterId] });
  if (!hasSupervisor) return null;
  if (!approver) throw noAvailableApproverError({ unavailableSupervisors: skipped.map((user) => user.name) });
  return [chainStep(approver, { sequence: 1, startedAt: new Date() })];
}

// Every submission, including a resubmission after OBSERVE or RETURN, resolves a
// fresh route from the request's current amount/track/area and the current
// roster, and restarts at the first approver. The previous route stays in the
// approval history and the audit log (see submitPreparedRequest).
export async function initializeApprovalRoute(request) {
  const chain = await resolveManagerChain(request);
  if (chain) {
    // Organizational identity never exempts a request from configured authority:
    // policy stages follow the chain and are skipped only when someone who
    // approved in the chain already holds that authority (finalizeChainApproval).
    const rules = await resolveApprovalRoute(request, { configuredOnly: true });
    for (const rule of rules.filter(rule => rule.required !== false)) {
      chain.push({ rule: rule.rule?._id || rule.rule || rule._id, approvalLevel: rule.approvalLevel, role: rule.role, sequence: chain.length + 1, slaHours: rule.slaHours, required: true, status: "NOT_REACHED", source: APPROVAL_ROUTING_MODE.RULE_BASED });
    }
    request.approvalRoutingMode = APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
    request.approvalRouteSnapshot = chain;
    const first = activeApprovalStep(request);
    request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = first?.dueAt || null;
    return request.approvalRouteSnapshot;
  }

  // No manager-chain identity exists for this requester (jefe not set in the organizational
  // roster). That is a master-data gap, not grounds to silently fall back to the generic
  // hardcoded default route - proceed only when a specifically configured ApprovalRule exists
  // for this exact area/type/flow/amount dimension (a real, deliberate exception), or when the
  // flow itself always defines its own default (Track B's expedited path already does, inside
  // resolveApprovalRoute). Otherwise this is a configuration error the requester cannot resolve.
  const configuredRules = await resolveApprovalRoute(request, { configuredOnly: true });
  if (!configuredRules.length) {
    throw new AppError(
      422,
      "This requester has no assigned supervisor in the organizational roster, and no approval rule is configured for this request's area, type, and flow. Fix the organizational roster (assign a supervisor) or configure an approval rule before this request can be submitted.",
      { area: request.requesterArea || request.requestingArea, requestType: request.requestType, flowType: request.flowType },
      ERROR_CODES.APPROVAL_ROUTE_NOT_CONFIGURED
    );
  }
  request.approvalRoutingMode = APPROVAL_ROUTING_MODE.RULE_BASED;
  const rules = configuredRules;
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

function approvedChainApproverIds(request) {
  return bySequence(request)
    .filter((step) => step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN && step.status === "APPROVED" && step.approverUser)
    .map((step) => idOf(step.approverUser));
}

function markApproved(step, decidingUser, completedAt) {
  step.status = "APPROVED";
  step.completedAt = completedAt;
  step.completedBy = decidingUser?._id || decidingUser;
}

// Manager-chain levels a legacy route pre-created as NOT_REACHED are closed as
// explicit skips once the deciding level forwards or finalizes, so the history
// shows exactly who was (and was not) asked.
function skipLegacyChainLevels(request, currentStep, completedAt) {
  for (const step of request.approvalRouteSnapshot || []) {
    if (step.source === APPROVAL_ROUTING_MODE.MANAGER_CHAIN && step.sequence > currentStep.sequence && OPEN_STEP_STATUSES.includes(step.status)) {
      step.status = "SKIPPED";
      step.completedAt = completedAt;
    }
  }
}

// Who "Send to my jefe" would reach from this chain step: the current approver's
// nearest available supervisor (inactive/on-leave managers skipped), never the
// requester or someone who already approved this route. null when there is none.
export async function nextChainApprover(request, currentStep = activeApprovalStep(request)) {
  if (!currentStep || currentStep.source !== APPROVAL_ROUTING_MODE.MANAGER_CHAIN || !currentStep.approverUser) return null;
  const exclude = [request.requester || request.solicitor, ...approvedChainApproverIds(request)];
  try {
    return (await nearestAvailableSupervisor(currentStep.approverUser, { exclude })).approver;
  } catch {
    return null;
  }
}

// "Send to my jefe": records this level's approval and adds the approver's own
// jefe as the next chain level, resolved now (not frozen at submission), ahead of
// any configured policy stage.
export async function activateNextChainStep(request, currentStep, decidingUser) {
  const nextApprover = await nextChainApprover(request, currentStep);
  if (!nextApprover) {
    throw new AppError(422, "There is no available manager above this approver (none, or they are inactive or on leave); the approval must be finalized here.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const completedAt = new Date();
  markApproved(currentStep, decidingUser, completedAt);
  skipLegacyChainLevels(request, currentStep, completedAt);
  for (const step of request.approvalRouteSnapshot || []) {
    if (step.sequence > currentStep.sequence) step.sequence += 1;
  }
  request.approvalRouteSnapshot.push(chainStep(nextApprover, { sequence: currentStep.sequence + 1, startedAt: completedAt }));
  const nextStep = activeApprovalStep(request);
  request.approvalStage = nextStep.approvalLevel;
  request.approvalDueAt = nextStep.dueAt;
  return { complete: false, next: nextStep, forwarded: true };
}

// "Approve and finalize": completes the manager chain at this level, whatever the
// level. Configured policy stages after the chain still apply, except those whose
// authority (role + approval level) a chain approver who approved already holds.
export async function finalizeChainApproval(request, currentStep, decidingUser) {
  const completedAt = new Date();
  markApproved(currentStep, decidingUser, completedAt);
  skipLegacyChainLevels(request, currentStep, completedAt);
  const approvers = await User.find({ _id: { $in: approvedChainApproverIds(request) } }).select("role approvalLevel").lean();
  const remaining = bySequence(request).filter((step) => step.sequence > currentStep.sequence && step.required !== false && OPEN_STEP_STATUSES.includes(step.status));
  for (const step of remaining) {
    if (approvers.some((user) => user.role === step.role && user.approvalLevel === step.approvalLevel)) {
      step.status = "SKIPPED";
      step.completedAt = completedAt;
    }
  }
  const next = remaining.find((step) => OPEN_STEP_STATUSES.includes(step.status));
  if (next) {
    next.status = "PENDING";
    next.startedAt = completedAt;
    next.dueAt = dueDate(next.slaHours, completedAt);
    request.approvalStage = next.approvalLevel;
    request.approvalDueAt = next.dueAt;
    return { complete: false, next };
  }
  request.approvalStage = APPROVAL_STAGES.COMPLETE;
  request.approvalDueAt = null;
  return { complete: true, next: null };
}

// Moves a pending chain step from an approver who left or went on leave to their
// nearest available jefe, with a fresh working-day SLA. Returns the previous holder.
export function reassignChainStep(request, step, approver, at = new Date()) {
  const previous = { approverUser: step.approverUser, approverSnapshot: step.approverSnapshot ? { name: step.approverSnapshot.name, jobTitle: step.approverSnapshot.jobTitle } : undefined, approvalLevel: step.approvalLevel };
  step.approverUser = approver._id;
  step.approverSnapshot = approverSnapshotOf(approver);
  step.approvalLevel = chainStepLabel(approver);
  step.role = approver.role;
  step.startedAt = at;
  step.dueAt = dueDate(step.slaHours, at);
  request.approvalStage = step.approvalLevel;
  request.approvalDueAt = step.dueAt;
  return previous;
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
