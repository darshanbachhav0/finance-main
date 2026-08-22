import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { APPROVAL_STAGES, PERMISSIONS, ROLES } from "../utils/constants.js";

const userSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.SOLICITOR, required: true },
    approvalLevel: {
      type: String,
      enum: [APPROVAL_STAGES.AREA_DIRECTOR, APPROVAL_STAGES.VICE_RECTOR, APPROVAL_STAGES.RECTORATE, APPROVAL_STAGES.GENERAL_MANAGEMENT],
      default: APPROVAL_STAGES.AREA_DIRECTOR
    },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    authorizedCostCenters: [{ type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" }],
    approvalAreas: [{ type: String, trim: true }],
    permissions: [{ type: String, enum: Object.values(PERMISSIONS) }],
    area: { type: String, trim: true, default: "General" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

userSchema.index({ active: 1, role: 1 });

export default mongoose.model("User", userSchema);
