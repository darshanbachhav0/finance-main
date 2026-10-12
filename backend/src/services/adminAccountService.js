import bcrypt from "bcrypt";
import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { accountStatus, temporaryPassword } from "./accountRecoveryService.js";
import { reassignPendingApprovalsFor } from "./approvalService.js";
import { recordAudit } from "./auditService.js";
import { escapedRegex } from "./queryService.js";

// Super Admin > Administrators: the only place where Admin accounts are created, edited,
// activated, reset or promoted. Super Admin accounts are listed read-only (they are created and
// recovered from the server: npm run superadmin:create / account:recover).
const MODULE = "SUPER_ADMIN";
const ACTIVITY_DAYS = 30;
const IDENTITY_FIELDS = ["name", "email", "area", "jobTitle", "organizationalUnit", "employeeCode"];
// Roles an Admin can go back to (or come from).
export const DEMOTION_ROLES = Object.freeze(Object.values(ROLES).filter((role) => ![ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGEMENT_VIEWER].includes(role)));

function notFound() {
  return new AppError(404, "Administrator not found.", undefined, ERROR_CODES.NOT_FOUND);
}

async function loadAdmin(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const user = await User.findById(id);
  if (!user || user.role !== ROLES.ADMIN) {
    if (user?.role === ROLES.SUPER_ADMIN) throw new AppError(403, "Super Admin accounts are managed from the server.", undefined, ERROR_CODES.ADMIN_ACCOUNT_PROTECTED);
    throw notFound();
  }
  return user;
}

// Deactivating or demoting must leave someone who can administer the platform.
async function assertAnotherActiveAdmin(user) {
  const others = await User.countDocuments({ role: ROLES.ADMIN, active: true, _id: { $ne: user._id } });
  if (!others) throw new AppError(409, "At least one active administrator must remain. Create or activate another Admin first.", undefined, ERROR_CODES.LAST_ADMIN);
}

function cleanIdentity(body) {
  const values = {};
  for (const field of IDENTITY_FIELDS) {
    if (body[field] === undefined) continue;
    const value = String(body[field] ?? "").trim();
    values[field] = field === "email" ? value.toLowerCase() || undefined : value || undefined;
  }
  if (values.name !== undefined && !values.name) throw new AppError(422, "Name is required.", { field: "name" }, ERROR_CODES.VALIDATION_ERROR);
  if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) throw new AppError(422, "Enter a valid email address.", { field: "email" }, ERROR_CODES.VALIDATION_ERROR);
  return values;
}

function cleanDni(value) {
  const dni = String(value ?? "").trim();
  if (!/^\d{8}$/.test(dni)) throw new AppError(422, "DNI must contain 8 digits.", { field: "dni" }, ERROR_CODES.VALIDATION_ERROR);
  return dni;
}

async function assertUnique({ dni, email }, exceptId) {
  const except = exceptId ? { _id: { $ne: exceptId } } : {};
  if (dni && await User.exists({ dni, ...except })) throw new AppError(409, "A user with this DNI already exists.", { field: "dni" }, ERROR_CODES.CONFLICT);
  if (email && await User.exists({ email, ...except })) throw new AppError(409, "A user with this email already exists.", { field: "email" }, ERROR_CODES.CONFLICT);
}

function adminView(user, activity = {}) {
  const status = accountStatus(user);
  return {
    _id: user._id,
    name: user.name,
    dni: user.dni,
    email: user.email,
    area: user.area,
    jobTitle: user.jobTitle,
    organizationalUnit: user.organizationalUnit,
    employeeCode: user.employeeCode,
    role: user.role,
    previousRole: user.previousRole || null,
    active: user.active !== false,
    locked: status.locked,
    lockedUntil: status.lockedUntil,
    failedLoginAttempts: status.failedLoginAttempts,
    passwordResetRequired: status.passwordResetRequired,
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || null,
    createdAt: user.createdAt,
    activity: {
      changes: activity.changes || 0,
      lastChangeAt: activity.lastChangeAt || null,
      signIns: activity.signIns || 0,
      failedSignIns: activity.failedSignIns || 0
    },
    // What the Super Admin may do with this row (Super Admin rows are read-only).
    manageable: user.role === ROLES.ADMIN
  };
}

// Per-person counters for the last 30 days: changes made (anything they did outside sign-in),
// sign-ins and failed sign-ins.
async function activityByUser(userIds, since) {
  if (!userIds.length) return new Map();
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [changes, signIns] = await Promise.all([
    AuditLog.aggregate([
      { $match: { actor: { $in: ids }, module: { $ne: "AUTH" }, createdAt: { $gte: since } } },
      { $group: { _id: "$actor", changes: { $sum: 1 }, lastChangeAt: { $max: "$createdAt" } } }
    ]),
    AuditLog.aggregate([
      { $match: { entityId: { $in: ids }, module: "AUTH", action: { $in: ["LOGIN_SUCCEEDED", "LOGIN_FAILED", "TWO_FACTOR_FAILED"] }, createdAt: { $gte: since } } },
      { $group: { _id: "$entityId", signIns: { $sum: { $cond: [{ $eq: ["$action", "LOGIN_SUCCEEDED"] }, 1, 0] } }, failedSignIns: { $sum: { $cond: [{ $eq: ["$action", "LOGIN_SUCCEEDED"] }, 0, 1] } } } }
    ])
  ]);
  const result = new Map(userIds.map((id) => [String(id), {}]));
  for (const row of changes) Object.assign(result.get(String(row._id)) || {}, { changes: row.changes, lastChangeAt: row.lastChangeAt });
  for (const row of signIns) Object.assign(result.get(String(row._id)) || {}, { signIns: row.signIns, failedSignIns: row.failedSignIns });
  return result;
}

export async function listAdministrators(query = {}) {
  const filter = { role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } };
  if (query.active !== undefined && query.active !== "") filter.active = String(query.active) === "true";
  if (query.search) {
    const search = new RegExp(escapedRegex(query.search), "i");
    filter.$or = [{ name: search }, { email: search }, { dni: search }, { area: search }];
  }
  const users = await User.find(filter).sort({ role: -1, active: -1, name: 1 }).limit(200);
  const activity = await activityByUser(users.map((user) => user._id), new Date(Date.now() - ACTIVITY_DAYS * 86400000));
  const data = users.map((user) => adminView(user, activity.get(String(user._id))));
  const summary = {
    activeAdmins: data.filter((row) => row.role === ROLES.ADMIN && row.active).length,
    inactiveAdmins: data.filter((row) => row.role === ROLES.ADMIN && !row.active).length,
    lockedAdmins: data.filter((row) => row.role === ROLES.ADMIN && row.locked).length,
    superAdmins: data.filter((row) => row.role === ROLES.SUPER_ADMIN && row.active).length,
    activityDays: ACTIVITY_DAYS
  };
  return { data, summary };
}

// A person's recent history: what they changed, and their sign-ins.
export async function administratorActivity(id, query = {}) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const user = await User.findById(id);
  if (!user || ![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(user.role)) throw notFound();
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const [changes, signIns] = await Promise.all([
    AuditLog.find({ actor: user._id, module: { $ne: "AUTH" } }).sort({ createdAt: -1 }).limit(limit).lean(),
    AuditLog.find({ entityId: user._id, module: "AUTH" }).sort({ createdAt: -1 }).limit(limit).lean()
  ]);
  const activity = await activityByUser([user._id], new Date(Date.now() - ACTIVITY_DAYS * 86400000));
  return { user: adminView(user, activity.get(String(user._id))), changes, signIns };
}

// Sets a new temporary password (shown once to the Super Admin), forces a change at the next
// sign-in and ends every open session.
async function applyTemporaryPassword(user) {
  const password = temporaryPassword();
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetRequired = true;
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  return password;
}

export async function createAdministrator(body, { actor, req }) {
  const identity = cleanIdentity(body);
  if (!identity.name) throw new AppError(422, "Name is required.", { field: "name" }, ERROR_CODES.VALIDATION_ERROR);
  const dni = cleanDni(body.dni);
  await assertUnique({ dni, email: identity.email });
  const user = new User({ ...identity, area: identity.area || "General", dni, role: ROLES.ADMIN, active: true, passwordHash: "pending" });
  const password = await applyTemporaryPassword(user);
  user.tokenVersion = 0;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_CREATED", user: actor, req, module: MODULE, newValues: { name: user.name, dni: user.dni, email: user.email, area: user.area, role: user.role } });
  return { data: adminView(user), temporaryPassword: password };
}

export async function updateAdministrator(id, body, { actor, req }) {
  const user = await loadAdmin(id);
  const identity = cleanIdentity(body);
  const dni = body.dni !== undefined ? cleanDni(body.dni) : undefined;
  await assertUnique({ dni, email: identity.email }, user._id);
  const oldValues = Object.fromEntries(["dni", ...IDENTITY_FIELDS].map((field) => [field, user[field]]));
  Object.assign(user, identity);
  if (dni) user.dni = dni;
  await user.save();
  const newValues = Object.fromEntries(["dni", ...IDENTITY_FIELDS].map((field) => [field, user[field]]));
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_UPDATED", user: actor, req, module: MODULE, oldValues, newValues });
  return { data: adminView(user) };
}

export async function setAdministratorActive(id, active, { actor, req }) {
  const user = await loadAdmin(id);
  if (Boolean(active) === (user.active !== false)) return { data: adminView(user) };
  if (!active) await assertAnotherActiveAdmin(user);
  user.active = Boolean(active);
  // A deactivated account is signed out everywhere.
  if (!active) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: active ? "ADMIN_ACTIVATED" : "ADMIN_DEACTIVATED", user: actor, req, module: MODULE, oldValues: { active: !active }, newValues: { active: Boolean(active) } });
  // Their pending approvals (an Admin can be someone's jefe) move to a substitute while inactive,
  // and come back on reactivation - the same rule as for every other account.
  const approvalReassignment = await reassignPendingApprovalsFor(user._id, { actor, req, reason: active ? "RETURNED" : "DEACTIVATED" });
  return { data: adminView(user), approvalReassignment };
}

export async function resetAdministratorPassword(id, { actor, req }) {
  const user = await loadAdmin(id);
  const password = await applyTemporaryPassword(user);
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_PASSWORD_RESET", user: actor, req, module: MODULE, newValues: { passwordResetRequired: true, sessionsRevoked: true, unlocked: true } });
  return { data: adminView(user), temporaryPassword: password };
}

export async function unlockAdministrator(id, { actor, req }) {
  const user = await loadAdmin(id);
  const before = accountStatus(user);
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_UNLOCKED", user: actor, req, module: MODULE, oldValues: { locked: before.locked, lockedUntil: before.lockedUntil }, newValues: { locked: false } });
  return { data: adminView(user) };
}

export async function signOutAdministrator(id, { actor, req }) {
  const user = await loadAdmin(id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_SIGNED_OUT", user: actor, req, module: MODULE, newValues: { sessionsRevoked: true } });
  return { data: adminView(user) };
}

// Gives an existing internal user the Admin role, remembering their role to restore on demotion.
export async function promoteToAdministrator(userId, { actor, req }) {
  if (!mongoose.isValidObjectId(userId)) throw new AppError(404, "User not found.", undefined, ERROR_CODES.NOT_FOUND);
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "User not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (user.role === ROLES.ADMIN) throw new AppError(409, "This person is already an administrator.", undefined, ERROR_CODES.CONFLICT);
  if (!DEMOTION_ROLES.includes(user.role)) throw new AppError(422, "Only an internal user can become an administrator.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (user.active === false) throw new AppError(422, "Activate this user before making them an administrator.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const previousRole = user.role;
  user.previousRole = previousRole;
  user.role = ROLES.ADMIN;
  // The new role applies from the next sign-in.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_PROMOTED", user: actor, req, module: MODULE, oldValues: { role: previousRole }, newValues: { name: user.name, role: ROLES.ADMIN } });
  return { data: adminView(user) };
}

export async function demoteAdministrator(id, body, { actor, req }) {
  const user = await loadAdmin(id);
  const role = body?.role || user.previousRole || ROLES.SOLICITOR;
  if (!DEMOTION_ROLES.includes(role)) throw new AppError(422, "Choose the role this person goes back to.", { field: "role", allowed: DEMOTION_ROLES }, ERROR_CODES.VALIDATION_ERROR);
  if (user.active !== false) await assertAnotherActiveAdmin(user);
  user.role = role;
  user.previousRole = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_DEMOTED", user: actor, req, module: MODULE, oldValues: { role: ROLES.ADMIN }, newValues: { name: user.name, role } });
  return { data: adminView(user) };
}
