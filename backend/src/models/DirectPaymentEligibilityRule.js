import mongoose from "mongoose";
import { EXPENSE_NATURES } from "../utils/constants.js";

// Track B ("direct payment") legitimately shortens the normal A1 procurement path (fewer
// documents, no quotation requirement) - it must only be available where Finance/Admin has
// deliberately configured it as an exception for a given area/expense-nature/amount, never as a
// free choice a requester can pick to skip A1's controls. No matching active rule means Track B
// is not available for that request; there is no hardcoded fallback amount or nature.
const directPaymentEligibilityRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    area: { type: String, trim: true, default: "*" },
    expenseNature: { type: String, enum: ["*", ...EXPENSE_NATURES], default: "*" },
    maxAmount: { type: Number, min: 0 },
    active: { type: Boolean, default: true },
    effectiveFrom: Date,
    effectiveTo: Date,
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

directPaymentEligibilityRuleSchema.pre("validate", function validateEffectiveRange() {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo < this.effectiveFrom) {
    this.invalidate("effectiveTo", "Effective-to date cannot be earlier than effective-from date.");
  }
});

directPaymentEligibilityRuleSchema.index({ active: 1, area: 1, expenseNature: 1 });

export default mongoose.model("DirectPaymentEligibilityRule", directPaymentEligibilityRuleSchema);
