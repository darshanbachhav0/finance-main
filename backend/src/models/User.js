import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { canonicalPermission, canonicalRole, sodViolations } from "../../../shared/accessControl.mjs";
import { ALL_PERMISSIONS, APPROVAL_STAGES, CANONICAL_ROLES, ROLES } from "../utils/constants.js";

// Sparse unique indexes exclude absent fields, but still index empty strings.
const optionalIdentifier = (value) => value == null || !String(value).trim() ? undefined : String(value).trim();

const userSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true, set: optionalIdentifier },
    dni: { type: String, trim: true, unique: true, sparse: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, set: optionalIdentifier },
    passwordHash: { type: String, required: true },
    passwordResetRequired: { type: Boolean, default: false },
    // Drives the password expiry policy (Super Admin > Platform settings); accounts that predate
    // it count from createdAt.
    passwordChangedAt: Date,
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    lastLoginIp: String,
    // Authenticator-app (TOTP) sign-in for administrators (ADMIN_2FA_REQUIRED makes it mandatory). The secrets are encrypted
    // (services/twoFactorService.js) and never leave the server.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: String,
      pendingSecret: String,
      enabledAt: Date,
      lastUsedStep: Number
    },
    // Kept from earlier versions (the role before a promotion to Admin); read-only history.
    previousRole: { type: String },
    jefe: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Who covers this person's approvals while they are on leave or inactive (e.g. the encargado/a
    // de la Gerencia General). Without one, their approvals go to their nearest available jefe.
    substitute: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    jobTitle: { type: String, trim: true },
    // Categoría del puesto (Portal de Personas, 1-8). Only the categories configured in
    // ENCARGO_JOB_CATEGORIES (utils/permissions.js: 3, 5 and 6) may charge another cost center.
    jobCategory: { type: Number, min: 1, max: 8, default: null },
    organizationalUnit: { type: String, trim: true },
    // Primary role: the person's home workspace and, where one answer is needed, their data scope.
    role: { type: String, enum: CANONICAL_ROLES, default: ROLES.SOLICITOR, required: true },
    // Additional roles of the same person (one identity, never one account per role). Their
    // permissions add up (shared/accessControl.mjs); segregation-of-duties rules decide which
    // combinations are allowed.
    roles: { type: [{ type: String, enum: CANONICAL_ROLES }], default: [] },
    // Set when an automatic step (role migration, roster import) could not decide reliably: the
    // administrator confirms the person's role, supervisor or cost center and clears it.
    accessReview: {
      required: { type: Boolean, default: false },
      reasons: [{ type: String, trim: true }],
      flaggedAt: Date
    },
    approvalLevel: {
      type: String,
      enum: [APPROVAL_STAGES.AREA_DIRECTOR, APPROVAL_STAGES.VICE_RECTOR, APPROVAL_STAGES.RECTORATE, APPROVAL_STAGES.GENERAL_MANAGEMENT],
      default: APPROVAL_STAGES.AREA_DIRECTOR
    },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    authorizedCostCenters: [{ type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" }],
    costCenterAssignment: {
      source: { type: String, trim: true },
      sourceRow: Number,
      assignedAt: Date,
      matchedBy: { type: String, enum: ["DNI", "EMPLOYEE_CODE"] }
    },
    approvalAreas: [{ type: String, trim: true }],
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    area: { type: String, trim: true, default: "General" },
    active: { type: Boolean, default: true },
    // Temporary absence (vacation, medical leave). An on-leave user keeps their
    // account but is skipped as an approver: pending manager-chain steps move to
    // their substitute (or, without one, their nearest available jefe), new
    // submissions route the same way, and the steps come back when they return.
    onLeave: { type: Boolean, default: false },
    leaveStartedAt: Date,
    leaveUntil: Date,
    // New bell notifications are also emailed to the user's address unless they turn it off
    // (services/notificationEmailService.js).
    emailNotifications: { type: Boolean, default: true },
    // DAILY: one summary email a day; IMMEDIATE: an email right away. Unset: the platform default
    // (NOTIFICATION_EMAIL_FREQUENCY, DAILY when not set).
    emailFrequency: { type: String, enum: ["DAILY", "IMMEDIATE"] },
    // Where the address came from when it was set by the contracts-master import.
    emailImport: {
      source: { type: String, trim: true },
      sourceRow: Number,
      importedAt: Date
    }
  },
  { timestamps: true }
);

// Values stored by earlier versions (a retired role such as SuperAdmin or Procurement, a
// "request:create"-style permission) are rewritten to the canonical ones when a record is saved.
// scripts/migrateCanonicalRoles.js does the same for every record at once, with a dry run first.
userSchema.pre("validate", function canonicalAccess(next) {
  const primary = canonicalRole(this.role);
  if (primary && primary !== this.role) this.role = primary;
  const extra = [...new Set((this.roles || []).map(canonicalRole).filter((role) => role && role !== this.role))];
  if (extra.length !== (this.roles || []).length || extra.some((role, index) => role !== this.roles[index])) this.roles = extra;
  const permissions = [...new Set((this.permissions || []).map(canonicalPermission).filter(Boolean))];
  if (permissions.length !== (this.permissions || []).length || permissions.some((permission, index) => permission !== this.permissions[index])) this.permissions = permissions;
  next();
});

// Combinations the segregation-of-duties rules forbid (Auditoría with anything else, Tesorería with
// GAF, Contabilidad with Tesorería) cannot be saved, whichever path saves the user.
userSchema.pre("validate", function segregationOfDuties(next) {
  const blocked = sodViolations([this.role, ...(this.roles || [])]).filter((rule) => rule.severity === "block");
  if (blocked.length) this.invalidate("roles", blocked.map((rule) => rule.message).join(" "));
  next();
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  obj.twoFactorEnabled = Boolean(obj.twoFactor?.enabled);
  delete obj.twoFactor;
  return obj;
};

userSchema.index({ active: 1, role: 1 });
userSchema.index({ active: 1, roles: 1 });
userSchema.index({ jefe: 1 });

export default mongoose.model("User", userSchema);
