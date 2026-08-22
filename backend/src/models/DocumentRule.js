import mongoose from "mongoose";
import { EXPENSE_NATURES, REQUEST_TYPES } from "../utils/constants.js";

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

documentRuleSchema.index({ active: 1, requestType: 1, expenseNature: 1 });

export default mongoose.model("DocumentRule", documentRuleSchema);
