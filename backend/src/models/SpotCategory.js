import mongoose from "mongoose";

// Configurable SPOT (detracciones) rate table. Seeded from shared/spotCategories.mjs; a rate
// change is recorded as a new row with its own effectiveFrom, closing the previous row with
// effectiveTo, so historical payables keep the rate that applied on their document date.
const spotCategorySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, match: /^\d{3}$/ },
    annex: { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0, max: 100 },
    minimumAmount: { type: Number, required: true, min: 0, default: 700 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    active: { type: Boolean, default: true },
    sourceReference: { type: String, trim: true, default: "R.S. 183-2004/SUNAT" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

spotCategorySchema.index({ code: 1, effectiveFrom: 1 }, { unique: true });
spotCategorySchema.pre("validate", function checkDates() {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo < this.effectiveFrom) {
    this.invalidate("effectiveTo", "Effective-to date cannot be earlier than effective-from date.");
  }
});

export default mongoose.model("SpotCategory", spotCategorySchema);
