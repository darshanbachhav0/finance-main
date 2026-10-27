import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { APPROVAL_STAGES, MANAGEMENT_VIEWER_PERMISSIONS, PERMISSIONS, ROLES } from "../utils/constants.js";

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
    // Authenticator-app (TOTP) sign-in, mandatory for the Super Admin. The secrets are encrypted
    // (services/twoFactorService.js) and never leave the server.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: String,
      pendingSecret: String,
      enabledAt: Date,
      lastUsedStep: Number
    },
    // The role a person had before the Super Admin promoted them to Admin; demoting restores it.
    previousRole: { type: String, enum: Object.values(ROLES).filter((role) => ![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) },
    jefe: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Who covers this person's approvals while they are on leave or inactive (e.g. the encargado/a
    // de la Gerencia General). Without one, their approvals go to their nearest available jefe.
    substitute: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    jobTitle: { type: String, trim: true },
    // Portal de Personas job category. Only 3, 5 and 6 may charge another CECO.
    jobCategory: { type: Number, min: 1 },
    organizationalUnit: { type: String, trim: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.SOLICITOR, required: true },
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
    permissions: [{ type: String, enum: Object.values(PERMISSIONS) }],
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

// ManagementViewer is portal-only and strictly read-only: it may never be granted any other
// permission (in particular no write capability), whatever path saves the user.
userSchema.pre("validate", function restrictManagementViewerPermissions(next) {
  if (this.role === ROLES.MANAGEMENT_VIEWER) {
    const disallowed = (this.permissions || []).filter((permission) => !MANAGEMENT_VIEWER_PERMISSIONS.includes(permission));
    if (disallowed.length) this.invalidate("permissions", `ManagementViewer cannot be granted: ${disallowed.join(", ")}.`);
  }
  next();
});

// The Super Admin never takes part in a process: no extra permissions, no approval areas, and no
// place in the reporting line (nobody's jefe or substitute is checked elsewhere; here, their own).
userSchema.pre("validate", function restrictSuperAdmin(next) {
  if (this.role === ROLES.SUPER_ADMIN) {
    if ((this.permissions || []).length) this.invalidate("permissions", "The Super Admin cannot be granted additional permissions.");
    if ((this.approvalAreas || []).length) this.invalidate("approvalAreas", "The Super Admin does not approve requests.");
    if (this.jefe || this.substitute) this.invalidate("jefe", "The Super Admin is outside the approval hierarchy.");
  }
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
userSchema.index({ jefe: 1 });

export default mongoose.model("User", userSchema);
