import mongoose from "mongoose";
import { DOCUMENT_PHASE, DOCUMENT_PHASES, EXPENSE_NATURES, FLOW_TYPES, REQUEST_TYPES } from "../utils/constants.js";

const documentRequirementSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, trim: true, uppercase: true },
    minCount: { type: Number, required: true, min: 1, default: 1 },
    labelKey: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const documentRuleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    flowType: { type: String, enum: ["*", ...FLOW_TYPES], default: "*" },
    phase: { type: String, enum: DOCUMENT_PHASES, default: DOCUMENT_PHASE.SUBMISSION },
    requestType: { type: String, enum: ["*", ...REQUEST_TYPES], default: "*" },
    expenseNature: { type: String, enum: ["*", ...EXPENSE_NATURES], default: "*" },
    requirements: { type: [documentRequirementSchema], default: [] },
    quotationPolicy: {
      enabled: { type: Boolean, default: false },
      minimumCount: { type: Number, min: 1, default: 3 },
      allowAuthorizedException: { type: Boolean, default: true },
      exceptionReasonRequired: { type: Boolean, default: true }
    },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

documentRuleSchema.index({ active: 1, phase: 1, flowType: 1, requestType: 1, expenseNature: 1 });

export default mongoose.model("DocumentRule", documentRuleSchema);
