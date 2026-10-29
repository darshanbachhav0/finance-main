import bcrypt from "bcrypt";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { reassignPendingApprovalsFor } from "../services/approvalService.js";
import { leaveLastDay, leaveSummary, notifySubstituteOfLeave } from "../services/userLeaveService.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { assertPasswordPolicy, getPlatformSettings } from "../services/platformSettingsService.js";
import { canonicalPermission, canonicalRole, rolesOf, sodViolations } from "../../../shared/accessControl.mjs";
import { APPROVAL_STAGES, ERROR_CODES, GRANTABLE_PERMISSIONS, REQUEST_STATUS, MAX_APPROVAL_CHAIN_DEPTH, ROLES } from "../utils/constants.js";
import { isReadOnlyOverseer } from "../utils/permissions.js";
import { accessReview, userChangeHistory } from "../services/accessReviewService.js";
import { EMAIL_FREQUENCIES } from "../services/notificationEmailService.js";
import NotificationDelivery from "../models/NotificationDelivery.js";

const terminalStatuses = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.PAID_CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED];

const editableFields = ["employeeCode", "dni", "name", "email", "jefe", "substitute", "jobTitle", "jobCategory", "organizationalUnit", "role", "roles", "approvalLevel", "approvalAreas", "costCenter", "authorizedCostCenters", "permissions", "area", "active", "onLeave", "leaveUntil", "emailNotifications"];

// Area Director and Vice-Rector are single-level roles: their approvalLevel is
// implied by the role itself, never a separate admin choice (unlike Management,
// which can sit at RECTORATE or GENERAL_MANAGEMENT and keeps approvalLevel editable).
const IMPLIED_APPROVAL_LEVEL = Object.freeze({
  [ROLES.AREA_DIRECTOR]: APPROVAL_STAGES.AREA_DIRECTOR,
  [ROLES.VICE_RECTOR]: APPROVAL_STAGES.VICE_RECTOR
});

function editablePayload(body) {
  const payload = Object.fromEntries(editableFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  if (payload.role !== undefined) payload.role = canonicalRole(payload.role) || payload.role;
  if (Array.isArray(payload.roles)) payload.roles = [...new Set(payload.roles.map(canonicalRole).filter((role) => role && role !== (payload.role ?? body.currentRole)))];
  if (payload.role && IMPLIED_APPROVAL_LEVEL[payload.role]) payload.approvalLevel = IMPLIED_APPROVAL_LEVEL[payload.role];
  // "No substitute" arrives as an empty choice.
  if (payload.substitute === "") payload.substitute = null;
  // Only grantable extras are stored (legacy values are read as their canonical permission).
  if (Array.isArray(payload.permissions)) payload.permissions = [...new Set(payload.permissions.map(canonicalPermission).filter((permission) => GRANTABLE_PERMISSIONS.includes(permission)))];
  return payload;
}

function protectedAccount(message, details) {
  return new AppError(403, message, details, ERROR_CODES.ADMIN_ACCOUNT_PROTECTED);
}

const sortedKey = (values) => [...new Set(values || [])].sort().join(",");

// Every role a saved user would hold after this change.
function nextRoles(target, payload) {
  return rolesOf({ role: payload.role ?? target?.role, roles: payload.roles ?? target?.roles ?? [] });
}

// Access changes are checked here before the model's own segregation-of-duties validation:
// - nobody changes their own roles or extra permissions (no self-escalation);
// - a blocking role combination is refused with its reason;
// - the last active administrator keeps the role and stays active.
export async function assertAccessChange(target, payload, actor) {
  const before = target ? rolesOf(target) : [];
  const after = nextRoles(target, payload);
  const rolesChanged = sortedKey(before) !== sortedKey(after);
  const permissionsChanged = payload.permissions !== undefined && sortedKey((target?.permissions || []).map(canonicalPermission)) !== sortedKey(payload.permissions);
  if (target && String(target._id) === String(actor?._id) && (rolesChanged || permissionsChanged)) {
    throw protectedAccount("You cannot change your own roles or permissions. Ask another administrator.", { field: rolesChanged ? "roles" : "permissions" });
  }
  const blocked = sodViolations(after).filter((rule) => rule.severity === "block");
  if (blocked.length) {
    throw new AppError(422, blocked.map((rule) => rule.message).join(" "), { field: "roles", segregationOfDuties: blocked.map((rule) => rule.id) }, ERROR_CODES.VALIDATION_ERROR);
  }
  const losesAdmin = before.includes(ROLES.ADMIN) && (!after.includes(ROLES.ADMIN) || payload.active === false);
  if (target && losesAdmin && target.active !== false) {
    const others = await User.countDocuments({ active: true, _id: { $ne: target._id }, $or: [{ role: ROLES.ADMIN }, { roles: ROLES.ADMIN }] });
    if (!others) throw new AppError(409, "At least one active administrator must remain. Assign the Admin role to someone else first.", undefined, ERROR_CODES.LAST_ADMIN);
  }
}

// Role and permission changes get their own audit events (the administrative change history).
async function auditSensitiveUserChanges(user, before, req) {
  const permissionsBefore = [...(before.permissions || [])].sort();
  const permissionsAfter = [...(user.permissions || [])].sort();
  if (permissionsBefore.join(",") !== permissionsAfter.join(",")) {
    await recordAudit({ entityType: "User", entity: user, action: "PERMISSIONS_CHANGED", user: req.user, req, module: "USER_ADMIN", oldValues: { permissions: permissionsBefore }, newValues: { name: user.name, permissions: permissionsAfter } });
  }
  const rolesBefore = rolesOf({ role: before.role, roles: before.roles || [] });
  const rolesAfter = rolesOf(user);
  if (sortedKey(rolesBefore) !== sortedKey(rolesAfter)) {
    const review = sodViolations(rolesAfter).filter((rule) => rule.severity === "review").map((rule) => rule.id);
    await recordAudit({ entityType: "User", entity: user, action: "ROLES_CHANGED", user: req.user, req, module: "USER_ADMIN", oldValues: { role: before.role, roles: rolesBefore }, newValues: { name: user.name, role: user.role, roles: rolesAfter, ...(review.length ? { segregationReview: review } : {}) } });
  }
}

export async function validateSupervisor(userId, supervisorId) {
  if (!supervisorId) return;
  const visited = new Set([String(userId)]);
  let next = supervisorId;
  for (let depth = 0; next; depth++) {
    if (depth >= MAX_APPROVAL_CHAIN_DEPTH || visited.has(String(next))) throw new AppError(422, "Supervisor assignment creates a cycle or exceeds the hierarchy depth.");
    visited.add(String(next));
    const manager = await User.findById(next).select("jefe active role roles").lean();
    if (!manager || manager.active === false || isReadOnlyOverseer(manager)) throw new AppError(422, "Choose an active, internal supervisor.");
    next = manager.jefe;
  }
}

// The substitute covers this person's approvals while they are away, so it must be someone else
// who can approve: an active, internal account.
export async function validateSubstitute(userId, substituteId) {
  if (!substituteId) return;
  if (userId && String(substituteId) === String(userId)) throw new AppError(422, "A person cannot be their own substitute.", { field: "substitute" }, ERROR_CODES.VALIDATION_ERROR);
  const substitute = await User.findById(substituteId).select("active role roles").lean();
  if (!substitute || substitute.active === false || isReadOnlyOverseer(substitute)) throw new AppError(422, "Choose an active, internal substitute.", { field: "substitute" }, ERROR_CODES.VALIDATION_ERROR);
}

// Availability follows active direct reports, rather than a fixed role.
export const listMyTeam = asyncHandler(async (req, res) => {
  const reports = await User.find({ jefe: req.user._id, active: true, _id: { $ne: req.user._id } })
    .select("name area jobTitle role organizationalUnit costCenter onLeave leaveUntil")
    .populate("costCenter", "code name")
    .sort({ name: 1 });
  if (!reports.length) throw new AppError(403, "My Team is available only to users with active team members.", undefined, ERROR_CODES.FORBIDDEN);
  const reportIds = reports.map((report) => report._id);
  const counts = reportIds.length ? await FinancialRequest.aggregate([
    { $match: { status: { $ne: REQUEST_STATUS.DRAFT }, $or: [{ requester: { $in: reportIds } }, { solicitor: { $in: reportIds } }] } },
    { $group: { _id: { $ifNull: ["$requester", "$solicitor"] }, total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ["$status", terminalStatuses] }, 0, 1] } } } }
  ]) : [];
  const countsById = new Map(counts.map((row) => [String(row._id), row]));
  const data = reports.map((report) => ({
    ...report.toObject(),
    requestCounts: countsById.get(String(report._id)) || { total: 0, active: 0 }
  }));
  res.json({ data });
});

export const listUsers = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.active !== undefined) query.active = req.query.active === "true";
  if (req.query.role) query.$and = [{ $or: [{ role: req.query.role }, { roles: req.query.role }] }];
  if (req.query.accessReview === "true") query["accessReview.required"] = true;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ name: search }, { email: search }, { employeeCode: search }, { dni: search }, { area: search }];
  }
  const { page, pageSize, skip } = parsePagination({ ...req.query, pageSize: req.query.pageSize || 100 });
  const sort = parseSort(req.query, ["name", "email", "role", "area", "active", "createdAt"], { name: 1 });
  const [data, total] = await Promise.all([
    User.find(query).populate("costCenter authorizedCostCenters").populate("jefe substitute", "name jobTitle").sort(sort).skip(skip).limit(pageSize),
    User.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

// One user, as the list shows it (a saved edit draft reopens its user this way).
export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate("costCenter authorizedCostCenters").populate("jefe substitute", "name jobTitle");
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  res.json({ data: user });
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, dni, email, password, role } = req.body;
  if (!name || !dni || !password || !role) throw new AppError(400, "Name, DNI, password, and role are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const normalizedDni = String(dni).trim();
  if (!/^\d{8}$/.test(normalizedDni)) throw new AppError(422, "DNI must contain 8 digits.");
  await assertAccessChange(null, editablePayload(req.body), req.user);
  assertPasswordPolicy(String(password), await getPlatformSettings());
  await validateSupervisor(null, req.body.jefe);
  await validateSubstitute(null, req.body.substitute);
  if (await User.exists({ dni: normalizedDni })) throw new AppError(409, "A user with this DNI already exists.", undefined, ERROR_CODES.CONFLICT);
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw new AppError(409, "A user with this email already exists.", undefined, ERROR_CODES.CONFLICT);
  }
  const user = await User.create({ ...editablePayload(req.body), dni: normalizedDni, email: email ? String(email).trim().toLowerCase() : undefined, passwordResetRequired: true, passwordChangedAt: new Date(), passwordHash: await bcrypt.hash(password, 12) });
  await recordAudit({ entityType: "User", entity: user, action: "CREATED", user: req.user, req, module: "USER_ADMIN", newValues: { name: user.name, dni: user.dni, role: user.role, roles: user.roles, area: user.area, active: user.active, permissions: user.permissions } });
  await auditSensitiveUserChanges(user, { role: undefined, roles: [], permissions: [] }, req);
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id) && req.body.active === false) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  const payload = editablePayload({ ...req.body, currentRole: user.role });
  await assertAccessChange(user, payload, req.user);
  if (req.body.jefe !== undefined) await validateSupervisor(user._id, req.body.jefe);
  if (req.body.substitute !== undefined) await validateSubstitute(user._id, req.body.substitute);
  if (req.body.dni !== undefined && !/^\d{8}$/.test(String(req.body.dni).trim())) throw new AppError(422, "DNI must contain 8 digits.");
  if (req.body.onLeave === true && req.body.leaveUntil && !user.onLeave) assertLeaveUntil(req.body.leaveUntil);
  const oldValues = { name: user.name, email: user.email, role: user.role, roles: [...(user.roles || [])], area: user.area, active: user.active, approvalLevel: user.approvalLevel, jefe: user.jefe, substitute: user.substitute, onLeave: Boolean(user.onLeave), leaveStartedAt: user.leaveStartedAt, emailNotifications: user.emailNotifications !== false, permissions: [...(user.permissions || [])] };
  Object.assign(user, payload);
  // Saving the record is the administrator's confirmation of an access flagged for review.
  if (req.body.accessReviewed === true && user.accessReview?.required) user.accessReview = { required: false, reasons: [] };
  applyLeaveDates(user, oldValues.onLeave);
  if (req.body.email) user.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password) {
    assertPasswordPolicy(String(req.body.password), await getPlatformSettings());
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.passwordResetRequired = true;
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "UPDATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { name: user.name, email: user.email, role: user.role, roles: [...(user.roles || [])], area: user.area, active: user.active, approvalLevel: user.approvalLevel, jefe: user.jefe, substitute: user.substitute, onLeave: Boolean(user.onLeave), leaveUntil: user.leaveUntil, emailNotifications: user.emailNotifications !== false, passwordChanged: Boolean(req.body.password) } });
  await auditSensitiveUserChanges(user, oldValues, req);
  const approvalReassignment = await reassignAfterAvailabilityChange(user, oldValues, req);
  res.json({ data: user, approvalReassignment });
});

function applyLeaveDates(user, wasOnLeave) {
  if (user.onLeave && !wasOnLeave) user.leaveStartedAt = new Date();
  if (!user.onLeave && wasOnLeave) {
    user.leaveStartedAt = undefined;
    user.leaveUntil = undefined;
  }
}

// When someone becomes unavailable (deactivated, on leave) their pending approvals move to their
// substitute or nearest available jefe; when they are back, the approvals a substitute held for
// them return; a new substitute for someone still away takes over what they hold.
async function reassignAfterAvailabilityChange(user, oldValues, req) {
  const deactivated = oldValues.active !== false && user.active === false;
  const wentOnLeave = !oldValues.onLeave && Boolean(user.onLeave);
  const available = user.active !== false && !user.onLeave;
  const returned = available && (Boolean(oldValues.onLeave) || oldValues.active === false);
  const substituteChanged = oldValues.substitute !== undefined && String(oldValues.substitute || "") !== String(user.substitute || "") && !available;
  const reason = deactivated ? "DEACTIVATED" : wentOnLeave ? "ON_LEAVE" : returned ? "RETURNED" : substituteChanged ? "SUBSTITUTE_CHANGED" : null;
  if (!reason) return undefined;
  const result = await reassignPendingApprovalsFor(user._id, { actor: req.user, req, reason });
  // The substitute hears when coverage starts and ends, not only when an approval arrives.
  if (wentOnLeave) await notifySubstituteOfLeave(user, { started: true });
  if (returned && oldValues.onLeave) await notifySubstituteOfLeave({ ...user.toObject(), substitute: user.substitute, leaveStartedAt: oldValues.leaveStartedAt }, { started: false });
  return result;
}

// The leave panel of the signed-in user: status, who covers their approvals, what is waiting.
export const getMyLeave = asyncHandler(async (req, res) => {
  res.json({ data: await leaveSummary(req.user._id) });
});

// "On leave until" is the last day of leave: never a day already past.
function assertLeaveUntil(value) {
  if (!value) return;
  const day = leaveLastDay(value);
  if (Number.isNaN(new Date(value).getTime())) throw new AppError(422, "Choose a valid last day of leave.", { field: "leaveUntil" }, ERROR_CODES.VALIDATION_ERROR);
  if (day < limaDateKey(new Date())) throw new AppError(422, "The last day of leave cannot be in the past.", { field: "leaveUntil" }, ERROR_CODES.VALIDATION_ERROR);
}

// Self-service: a user may record their own leave (and return from it).
export const updateMyLeave = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(404, "User not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (typeof req.body.onLeave !== "boolean") throw new AppError(422, "onLeave must be true or false.", { field: "onLeave" }, ERROR_CODES.VALIDATION_ERROR);
  if (req.body.onLeave) assertLeaveUntil(req.body.leaveUntil);
  const oldValues = { active: user.active, onLeave: Boolean(user.onLeave), leaveUntil: user.leaveUntil, leaveStartedAt: user.leaveStartedAt };
  user.onLeave = req.body.onLeave;
  if (req.body.leaveUntil !== undefined) user.leaveUntil = req.body.leaveUntil || undefined;
  applyLeaveDates(user, oldValues.onLeave);
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: user.onLeave ? "LEAVE_STARTED" : "LEAVE_ENDED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { onLeave: user.onLeave, leaveUntil: user.leaveUntil } });
  const approvalReassignment = await reassignAfterAvailabilityChange(user, oldValues, req);
  res.json({ data: user, approvalReassignment, leave: await leaveSummary(user._id) });
});

// Self-service: the signed-in user turns the emailed copy of their notifications on or off, and
// chooses one summary a day (DAILY) or an email right away (IMMEDIATE).
export const updateMyNotificationPreferences = asyncHandler(async (req, res) => {
  const hasSwitch = req.body.emailNotifications !== undefined;
  const hasFrequency = req.body.emailFrequency !== undefined;
  if (!hasSwitch && !hasFrequency) throw new AppError(422, "emailNotifications must be true or false.", { field: "emailNotifications" }, ERROR_CODES.VALIDATION_ERROR);
  if (hasSwitch && typeof req.body.emailNotifications !== "boolean") throw new AppError(422, "emailNotifications must be true or false.", { field: "emailNotifications" }, ERROR_CODES.VALIDATION_ERROR);
  if (hasFrequency && !EMAIL_FREQUENCIES.includes(req.body.emailFrequency)) throw new AppError(422, "emailFrequency must be DAILY or IMMEDIATE.", { field: "emailFrequency" }, ERROR_CODES.VALIDATION_ERROR);
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(404, "User not found.", undefined, ERROR_CODES.NOT_FOUND);
  const oldValues = { emailNotifications: user.emailNotifications !== false, emailFrequency: user.emailFrequency || null };
  if (hasSwitch) user.emailNotifications = req.body.emailNotifications;
  if (hasFrequency) user.emailFrequency = req.body.emailFrequency;
  await user.save();
  // "Right away" also sends what was waiting for the daily summary.
  if (hasFrequency && user.emailFrequency === "IMMEDIATE") await NotificationDelivery.updateMany({ user: user._id, channel: "EMAIL", status: "PENDING", sendAfter: { $gt: new Date() } }, { $set: { sendAfter: new Date() } });
  await recordAudit({ entityType: "User", entity: user, action: "NOTIFICATION_PREFERENCES_UPDATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { emailNotifications: user.emailNotifications, emailFrequency: user.emailFrequency || null } });
  res.json({ data: user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id)) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  await assertAccessChange(user, { active: false }, req.user);
  const oldValues = { active: user.active };
  user.active = false;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "DEACTIVATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { active: false } });
  const approvalReassignment = await reassignAfterAvailabilityChange(user, { ...oldValues, onLeave: Boolean(user.onLeave) }, req);
  res.json({ data: user, approvalReassignment });
});

// Administración > Roles y permisos: segregation-of-duties conflicts, records flagged for review,
// people without a supervisor or cost center, cost centers without a responsible.
export const getAccessReview = asyncHandler(async (_req, res) => {
  res.json({ data: await accessReview() });
});

// The administrative change history of one person (role, permission, organization changes).
export const getUserHistory = asyncHandler(async (req, res) => {
  res.json(await userChangeHistory(req.params.id, req.query));
});
