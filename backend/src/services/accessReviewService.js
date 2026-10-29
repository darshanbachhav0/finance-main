import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import CostCenter from "../models/CostCenter.js";
import User from "../models/User.js";
import { rolesOf, sodViolations } from "../../../shared/accessControl.mjs";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { paginatedPayload, parsePagination } from "./queryService.js";

// Audit modules that record administration (accounts, roles, sign-in, master data, platform settings).
// "SUPER_ADMIN" is the module name earlier versions used for platform settings and backups.
export const ADMINISTRATIVE_AUDIT_MODULES = Object.freeze(["USER_ADMIN", "AUTH", "SUPER_ADMIN", "PLATFORM", "MASTER_DATA", "SECURITY"]);

const PERSON_FIELDS = "name dni employeeCode area jobTitle role roles jefe costCenter active accessReview";
const person = (user) => ({ _id: user._id, name: user.name, dni: user.dni, area: user.area, jobTitle: user.jobTitle, roles: rolesOf(user) });

// What the administrator should look at in the access configuration. Nothing here changes data:
// each finding links to the person or cost center to correct.
//   conflicts       - role combinations under a segregation-of-duties rule ("block" ones can only
//                     exist in records saved before the rule, e.g. not yet migrated)
//   flagged         - records an automatic step could not match reliably (accessReview.required)
//   noSupervisor    - active people with no direct supervisor, other than the top of the hierarchy
//                     (Gerencia General) and pure administrator/audit accounts
//   noCostCenter    - active people who raise requests without a primary cost center
//   noResponsible   - active cost centers without a responsible to approve them
//   administrators  - active administrators (the last one cannot be removed)
export async function accessReview() {
  const [users, centers] = await Promise.all([
    User.find({ active: true }).select(PERSON_FIELDS).sort({ name: 1 }).lean(),
    CostCenter.find({ active: true, $or: [{ responsible: null }, { responsible: { $exists: false } }] }).select("code name area level").sort({ code: 1 }).lean()
  ]);
  const conflicts = [];
  const flagged = [];
  const noSupervisor = [];
  const noCostCenter = [];
  const administrators = [];
  for (const user of users) {
    const roles = rolesOf(user);
    for (const rule of sodViolations(roles)) conflicts.push({ person: person(user), rule: rule.id, severity: rule.severity, message: rule.message });
    if (user.accessReview?.required) flagged.push({ person: person(user), reasons: user.accessReview.reasons || [], flaggedAt: user.accessReview.flaggedAt || null });
    const outsideHierarchy = roles.every((role) => [ROLES.ADMIN, ROLES.AUDITOR, ROLES.MANAGEMENT].includes(role));
    if (!user.jefe && !outsideHierarchy) noSupervisor.push(person(user));
    if (!user.costCenter && roles.includes(ROLES.SOLICITOR)) noCostCenter.push(person(user));
    if (roles.includes(ROLES.ADMIN)) administrators.push(person(user));
  }
  return {
    conflicts,
    flagged,
    noSupervisor,
    noCostCenter,
    noResponsible: centers.map((center) => ({ _id: center._id, code: center.code, name: center.name, area: center.area, level: center.level })),
    administrators,
    summary: {
      conflicts: conflicts.length,
      blockingConflicts: conflicts.filter((item) => item.severity === "block").length,
      flagged: flagged.length,
      noSupervisor: noSupervisor.length,
      noCostCenter: noCostCenter.length,
      noResponsible: centers.length,
      administrators: administrators.length
    },
    checkedAt: new Date()
  };
}

// The administrative history of one person: every audit event recorded on their user record
// (creation, role and permission changes, organization, leave, sign-in protection). Append-only.
export async function userChangeHistory(userId, query = {}) {
  if (!mongoose.isValidObjectId(userId)) throw new AppError(404, "User not found.", { id: userId }, ERROR_CODES.NOT_FOUND);
  const filter = { entityType: "User", entityId: { $in: [new mongoose.Types.ObjectId(String(userId)), String(userId)] }, module: { $ne: "AUTH" } };
  const { page, pageSize, skip } = parsePagination({ ...query, pageSize: query.pageSize || 25 });
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).select("action module actorName role oldValues newValues comments createdAt").lean(),
    AuditLog.countDocuments(filter)
  ]);
  return paginatedPayload(rows, total, page, pageSize);
}
