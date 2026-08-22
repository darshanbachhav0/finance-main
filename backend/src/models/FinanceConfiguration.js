import mongoose from "mongoose";
import {
  CURRENCY,
  FINANCE_CONFIGURATION_BEHAVIORS,
  FINANCE_CONFIGURATION_KEYS
} from "../utils/constants.js";

const financeConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, enum: Object.values(FINANCE_CONFIGURATION_KEYS), required: true, trim: true, uppercase: true },
    numericValue: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, default: "PEN", required: true },
    behavior: { type: String, enum: FINANCE_CONFIGURATION_BEHAVIORS, default: "WARNING", required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: Date,
    active: { type: Boolean, default: true },
    description: { type: String, trim: true, default: "" },
    source: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

financeConfigurationSchema.pre("validate", function validateEffectiveRange() {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo < this.effectiveFrom) {
    this.invalidate("effectiveTo", "Effective-to date cannot be earlier than effective-from date.");
  }
});

financeConfigurationSchema.index({ key: 1, active: 1, effectiveFrom: -1, effectiveTo: 1 });

export default mongoose.model("FinanceConfiguration", financeConfigurationSchema);
