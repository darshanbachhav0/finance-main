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
    tokenVersion: { type: Number, default: 0 },
    // Per-account sign-in lockout (authController.login).
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    jefe: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Who covers this person's approvals while they are on leave or inactive (e.g. the encargado/a
    // de la Gerencia General). Without one, their approvals go to their nearest available jefe.
    substitute: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    jobTitle: { type: String, trim: true },
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

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.failedLoginAttempts;
  delete obj.lockedUntil;
  return obj;
};

userSchema.index({ active: 1, role: 1 });
userSchema.index({ jefe: 1 });

export default mongoose.model("User", userSchema);
