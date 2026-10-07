import bcrypt from "bcrypt";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { reassignPendingApprovalsFor } from "../services/approvalService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { APPROVAL_STAGES, ERROR_CODES, GRANTABLE_PERMISSIONS, MANAGEMENT_VIEWER_PERMISSIONS, REQUEST_STATUS, MAX_APPROVAL_CHAIN_DEPTH, ROLES } from "../utils/constants.js";

const terminalStatuses = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.PAID_CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED];

const editableFields = ["employeeCode", "dni", "name", "email", "jefe", "substitute", "jobTitle", "organizationalUnit", "role", "approvalLevel", "approvalAreas", "costCenter", "authorizedCostCenters", "permissions", "area", "active", "onLeave", "leaveUntil"];

// Area Director and Vice-Rector are single-level roles: their approvalLevel is
// implied by the role itself, never a separate admin choice (unlike Management,
// which can sit at RECTORATE or GENERAL_MANAGEMENT and keeps approvalLevel editable).
const IMPLIED_APPROVAL_LEVEL = Object.freeze({
  [ROLES.AREA_DIRECTOR]: APPROVAL_STAGES.AREA_DIRECTOR,
  [ROLES.VICE_RECTOR]: APPROVAL_STAGES.VICE_RECTOR
});

function editablePayload(body) {
  const payload = Object.fromEntries(editableFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  if (payload.role && IMPLIED_APPROVAL_LEVEL[payload.role]) payload.approvalLevel = IMPLIED_APPROVAL_LEVEL[payload.role];
  // "No substitute" arrives as an empty choice.
  if (payload.substitute === "") payload.substitute = null;
  // Only grantable extras are stored; a legacy, non-grantable value (which never had any effect)
  // is dropped the next time the user is saved.
  if (Array.isArray(payload.permissions)) payload.permissions = [...new Set(payload.permissions.filter((permission) => GRANTABLE_PERMISSIONS.includes(permission)))];
  return payload;
}

// ManagementViewer is portal-only and read-only: reject any extra permission up front with a
// clear message (the User model enforces the same rule on every save).
function assertManagementViewerPermissions(role, permissions) {
  if (role !== ROLES.MANAGEMENT_VIEWER) return;
  const disallowed = (Array.isArray(permissions) ? permissions : []).filter((permission) => !MANAGEMENT_VIEWER_PERMISSIONS.includes(permission));
  if (disallowed.length) {
    throw new AppError(422, "A Management Viewer only has access to the management portal; additional permissions cannot be granted.", { field: "permissions", disallowed }, ERROR_CODES.VALIDATION_ERROR);
  }
}

export async function validateSupervisor(userId, supervisorId) {
  if (!supervisorId) return;
  const visited = new Set([String(userId)]);
  let next = supervisorId;
  for (let depth = 0; next; depth++) {
    if (depth >= MAX_APPROVAL_CHAIN_DEPTH || visited.has(String(next))) throw new AppError(422, "Supervisor assignment creates a cycle or exceeds the hierarchy depth.");
    visited.add(String(next));
    const manager = await User.findById(next).select("jefe active role").lean();
    if (!manager || manager.active === false || manager.role === "ManagementViewer") throw new AppError(422, "Choose an active, internal supervisor.");
    next = manager.jefe;
  }
}

// The substitute covers this person's approvals while they are away, so it must be someone else
// who can approve: an active, internal account.
export async function validateSubstitute(userId, substituteId) {
  if (!substituteId) return;
  if (userId && String(substituteId) === String(userId)) throw new AppError(422, "A person cannot be their own substitute.", { field: "substitute" }, ERROR_CODES.VALIDATION_ERROR);
  const substitute = await User.findById(substituteId).select("active role").lean();
  if (!substitute || substitute.active === false || substitute.role === ROLES.MANAGEMENT_VIEWER) throw new AppError(422, "Choose an active, internal substitute.", { field: "substitute" }, ERROR_CODES.VALIDATION_ERROR);
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
  if (req.query.role) query.role = req.query.role;
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

export const createUser = asyncHandler(async (req, res) => {
  const { name, dni, email, password, role } = req.body;
  if (!name || !dni || !password || !role) throw new AppError(400, "Name, DNI, password, and role are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (String(password).length < 10) throw new AppError(422, "Password must contain at least 10 characters.", { field: "password" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedDni = String(dni).trim();
  if (!/^\d{8}$/.test(normalizedDni)) throw new AppError(422, "DNI must contain 8 digits.");
  assertManagementViewerPermissions(role, req.body.permissions);
  await validateSupervisor(null, req.body.jefe);
  await validateSubstitute(null, req.body.substitute);
  if (await User.exists({ dni: normalizedDni })) throw new AppError(409, "A user with this DNI already exists.", undefined, ERROR_CODES.CONFLICT);
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw new AppError(409, "A user with this email already exists.", undefined, ERROR_CODES.CONFLICT);
  }
  const user = await User.create({ ...editablePayload(req.body), dni: normalizedDni, email: email ? String(email).trim().toLowerCase() : undefined, passwordResetRequired: true, passwordHash: await bcrypt.hash(password, 12) });
  await recordAudit({ entityType: "User", entity: user, action: "CREATED", user: req.user, req, module: "USER_ADMIN", newValues: { name: user.name, dni: user.dni, role: user.role, area: user.area, active: user.active } });
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id) && req.body.active === false) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  assertManagementViewerPermissions(req.body.role ?? user.role, req.body.permissions ?? user.permissions);
  if (req.body.jefe !== undefined) await validateSupervisor(user._id, req.body.jefe);
  if (req.body.substitute !== undefined) await validateSubstitute(user._id, req.body.substitute);
  if (req.body.dni !== undefined && !/^\d{8}$/.test(String(req.body.dni).trim())) throw new AppError(422, "DNI must contain 8 digits.");
  const oldValues = { name: user.name, email: user.email, role: user.role, area: user.area, active: user.active, approvalLevel: user.approvalLevel, jefe: user.jefe, substitute: user.substitute, onLeave: Boolean(user.onLeave) };
  Object.assign(user, editablePayload(req.body));
  applyLeaveDates(user, oldValues.onLeave);
  if (req.body.email) user.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password) {
    if (String(req.body.password).length < 10) throw new AppError(422, "Password must contain at least 10 characters.", { field: "password" }, ERROR_CODES.VALIDATION_ERROR);
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.passwordResetRequired = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    // An administrator's password reset also lifts a sign-in lockout.
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
  }
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "UPDATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { name: user.name, email: user.email, role: user.role, area: user.area, active: user.active, approvalLevel: user.approvalLevel, jefe: user.jefe, substitute: user.substitute, onLeave: Boolean(user.onLeave), leaveUntil: user.leaveUntil, passwordChanged: Boolean(req.body.password) } });
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
  return reassignPendingApprovalsFor(user._id, { actor: req.user, req, reason });
}

// Self-service: a user may record their own leave (and return from it).
export const updateMyLeave = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(404, "User not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (typeof req.body.onLeave !== "boolean") throw new AppError(422, "onLeave must be true or false.", { field: "onLeave" }, ERROR_CODES.VALIDATION_ERROR);
  const oldValues = { active: user.active, onLeave: Boolean(user.onLeave), leaveUntil: user.leaveUntil };
  user.onLeave = req.body.onLeave;
  if (req.body.leaveUntil !== undefined) user.leaveUntil = req.body.leaveUntil || undefined;
  applyLeaveDates(user, oldValues.onLeave);
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: user.onLeave ? "LEAVE_STARTED" : "LEAVE_ENDED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { onLeave: user.onLeave, leaveUntil: user.leaveUntil } });
  const approvalReassignment = await reassignAfterAvailabilityChange(user, oldValues, req);
  res.json({ data: user, approvalReassignment });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id)) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  const oldValues = { active: user.active };
  user.active = false;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "DEACTIVATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { active: false } });
  const approvalReassignment = await reassignAfterAvailabilityChange(user, { ...oldValues, onLeave: Boolean(user.onLeave) }, req);
  res.json({ data: user, approvalReassignment });
});
