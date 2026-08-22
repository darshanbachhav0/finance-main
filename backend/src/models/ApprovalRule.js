import mongoose from "mongoose";
import { APPROVAL_STAGES, FLOW_TYPES, REQUEST_TYPES, ROLES } from "../utils/constants.js";

const approvalRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    approvalLevel: { type: String, enum: Object.values(APPROVAL_STAGES), required: true },
    role: { type: String, enum: Object.values(ROLES), required: true },
    area: { type: String, trim: true, default: "*" },
    amountFrom: { type: Number, min: 0, default: 0 },
    amountTo: { type: Number, min: 0 },
    requestType: { type: String, enum: ["*", ...REQUEST_TYPES], default: "*" },
    flowType: { type: String, enum: ["*", ...FLOW_TYPES], default: "*" },
    required: { type: Boolean, default: true },
    sequence: { type: Number, required: true, min: 1 },
    slaHours: { type: Number, required: true, min: 1, default: 24 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

approvalRuleSchema.index({ active: 1, area: 1, requestType: 1, flowType: 1, amountFrom: 1, amountTo: 1, sequence: 1 });

export default mongoose.model("ApprovalRule", approvalRuleSchema);

