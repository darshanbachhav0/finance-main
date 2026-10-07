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
  if (configuredOnly) return [];
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

const APPROVER_FIELDS = "name jobTitle active onLeave jefe substitute role approvalLevel";

// The substitute who covers an unavailable manager, when one is set and can act now. One level
// only: a substitute's own substitute is not followed (the chain above takes over instead).
export async function availableSubstituteOf(user, { exclude = [] } = {}) {
  if (!user?.substitute) return null;
  const substitute = await User.findById(idOf(user.substitute)).select(APPROVER_FIELDS).lean();
  if (!isAvailableApprover(substitute) || exclude.some((id) => idOf(id) === idOf(substitute._id))) return null;
  return substitute;
}

// Who holds the approvals of `owner` right now: the owner while available, otherwise their
// substitute, otherwise the nearest available supervisor above them. coveringFor names the absent
// manager when a substitute stands in.
export async function approverFor(owner, { exclude = [] } = {}) {
  const person = owner?.name !== undefined ? owner : await User.findById(idOf(owner)).select(APPROVER_FIELDS).lean();
  if (!person) return { approver: null, coveringFor: null };
  if (isAvailableApprover(person) && !exclude.some((id) => idOf(id) === idOf(person._id))) return { approver: person, coveringFor: null };
  const substitute = await availableSubstituteOf(person, { exclude });
  if (substitute) return { approver: substitute, coveringFor: person };
  const { approver, coveringFor } = await nearestAvailableSupervisor(person._id, { exclude });
  return { approver, coveringFor };
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
    const jefe = await User.findById(jefeId).select(APPROVER_FIELDS).lean();
    if (!jefe) break;
    chain.push(jefe);
    current = jefe;
  }
  return chain;
}

// The nearest supervisor above userId who can act now. An inactive or on-leave manager hands over
// to their substitute when one is set and available (coveringFor names the absent manager);
// otherwise they are skipped going up, so an absence never strands a request.
export async function nearestAvailableSupervisor(userId, { exclude = [] } = {}) {
  const excluded = new Set(exclude.filter(Boolean).map(idOf));
  const chain = await supervisorChainOf(userId);
  const skipped = [];
  for (const jefe of chain) {
    if (isAvailableApprover(jefe) && !excluded.has(idOf(jefe._id))) return { approver: jefe, coveringFor: null, skipped, hasSupervisor: true };
    if (!isAvailableApprover(jefe)) {
      const substitute = await availableSubstituteOf(jefe, { exclude: [...excluded] });
      if (substitute) return { approver: substitute, coveringFor: jefe, skipped, hasSupervisor: true };
    }
    skipped.push(jefe);
  }
  return { approver: null, coveringFor: null, skipped, hasSupervisor: chain.length > 0 };
}

export function noAvailableApproverError(details) {
  return new AppError(
    422,
    "No supervisor is available to approve this request: every manager above you in the organizational roster is inactive or on leave. Contact the Admin to update the roster.",
    details,
    ERROR_CODES.APPROVAL_ROUTE_NOT_CONFIGURED
  );
}

function chainStep(jefe, { sequence, startedAt, coveringFor = null }) {
  const slaHours = approvalStepSlaHours();
  return {
    approverUser: jefe._id,
    approverSnapshot: approverSnapshotOf(jefe),
    ...(coveringFor ? { coveringFor: coveringFor._id, coveringForSnapshot: approverSnapshotOf(coveringFor) } : {}),
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
// from the org roster, or admin-created accounts) must have a supervisor assigned.
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
  const { approver, coveringFor, skipped, hasSupervisor } = await nearestAvailableSupervisor(requesterId, { exclude: [requesterId] });
  if (!hasSupervisor) return null;
  if (!approver) throw noAvailableApproverError({ unavailableSupervisors: skipped.map((user) => user.name) });
  return [chainStep(approver, { sequence: 1, startedAt: new Date(), coveringFor })];
}

// Every submission, including a resubmission after OBSERVE or RETURN, resolves a
// fresh route from the request's current amount/track/area and the current
// roster, and restarts at the first approver. The previous route stays in the
// approval history and the audit log (see submitPreparedRequest).
export async function initializeApprovalRoute(request) {
  const chain = await resolveManagerChain(request);
  if (chain) {
    request.approvalRoutingMode = APPROVAL_ROUTING_MODE.MANAGER_CHAIN;
    request.approvalRouteSnapshot = chain;
    const first = activeApprovalStep(request);
    request.approvalStage = first?.approvalLevel || APPROVAL_STAGES.COMPLETE;
    request.approvalDueAt = first?.dueAt || null;
    return request.approvalRouteSnapshot;
  }

  throw new AppError(422,
    "Assign an active supervisor to this requester in User Administration before submitting. Requests without a jefe cannot be sent to a generic or demo approval account.",
    { field: "jefe" }, ERROR_CODES.APPROVAL_ROUTE_NOT_CONFIGURED);
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
// The next chain level above the current step. A substitute stands in the absent manager's
// position, so "send to my jefe" goes above that manager, not above the substitute.
export async function nextChainApproval(request, currentStep = activeApprovalStep(request)) {
  if (!currentStep || currentStep.source !== APPROVAL_ROUTING_MODE.MANAGER_CHAIN || !currentStep.approverUser) return { approver: null, coveringFor: null };
  const exclude = [request.requester || request.solicitor, currentStep.approverUser, ...approvedChainApproverIds(request)];
  try {
    const { approver, coveringFor } = await nearestAvailableSupervisor(currentStep.coveringFor || currentStep.approverUser, { exclude });
    return { approver, coveringFor };
  } catch {
    return { approver: null, coveringFor: null };
  }
}

export async function nextChainApprover(request, currentStep = activeApprovalStep(request)) {
  return (await nextChainApproval(request, currentStep)).approver;
}

// "Send to my jefe": records this level's approval and adds the approver's own
// jefe as the next chain level, resolved now (not frozen at submission), ahead of
// any configured policy stage.
export async function activateNextChainStep(request, currentStep, decidingUser) {
  const { approver: nextApprover, coveringFor } = await nextChainApproval(request, currentStep);
  if (!nextApprover) {
    throw new AppError(422, "There is no available manager above this approver (none, or they are inactive or on leave); the approval must be finalized here.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const completedAt = new Date();
  markApproved(currentStep, decidingUser, completedAt);
  skipLegacyChainLevels(request, currentStep, completedAt);
  for (const step of request.approvalRouteSnapshot || []) {
    if (step.sequence > currentStep.sequence) step.sequence += 1;
  }
  request.approvalRouteSnapshot.push(chainStep(nextApprover, { sequence: currentStep.sequence + 1, startedAt: completedAt, coveringFor }));
  const nextStep = activeApprovalStep(request);
  request.approvalStage = nextStep.approvalLevel;
  request.approvalDueAt = nextStep.dueAt;
  return { complete: false, next: nextStep, forwarded: true };
}

// "Approve and finalize": completes the manager chain at this level, whatever the
// level. Legacy policy tails are retained as explicit skips, not new approvals.
export async function finalizeChainApproval(request, currentStep, decidingUser) {
  const completedAt = new Date();
  markApproved(currentStep, decidingUser, completedAt);
  skipLegacyChainLevels(request, currentStep, completedAt);
  // The jefe's final decision supersedes only uncompleted legacy tail steps.
  // Completed sign-offs and the original route remain available for audit.
  for (const step of request.approvalRouteSnapshot || []) {
    if (step.sequence > currentStep.sequence && OPEN_STEP_STATUSES.includes(step.status)) {
      step.status = "SKIPPED";
      step.completedAt = completedAt;
    }
  }
  request.approvalStage = APPROVAL_STAGES.COMPLETE;
  request.approvalDueAt = null;
  return { complete: true, next: null };
}

// Moves a pending chain step to whoever holds it now (the substitute or nearest available jefe
// of an absent approver, or the approver back from leave), with a fresh working-day SLA.
// Returns the previous holder.
export function reassignChainStep(request, step, approver, at = new Date(), { coveringFor = null } = {}) {
  const previous = { approverUser: step.approverUser, approverSnapshot: step.approverSnapshot ? { name: step.approverSnapshot.name, jobTitle: step.approverSnapshot.jobTitle } : undefined, approvalLevel: step.approvalLevel, coveringFor: step.coveringFor };
  step.approverUser = approver._id;
  step.approverSnapshot = approverSnapshotOf(approver);
  step.coveringFor = coveringFor?._id || undefined;
  step.coveringForSnapshot = coveringFor ? approverSnapshotOf(coveringFor) : undefined;
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
