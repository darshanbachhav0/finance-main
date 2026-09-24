import mongoose from "mongoose";
import { BANKS, CURRENCY } from "../utils/constants.js";

const bankFormatConfigurationSchema = new mongoose.Schema(
  {
    bank: { type: String, enum: BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true },
    mode: { type: String, enum: ["DEMO", "CERTIFIED", "FIXED_WIDTH"], default: "DEMO" },
    bbva: { type: mongoose.Schema.Types.Mixed },
    specificationVersion: { type: String, required: true, default: "UMA-DEMO-1" },
    certified: { type: Boolean, default: false },
    certifiedAt: { type: Date, default: null },
    certifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    certificationReference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "DEMO / NOT CERTIFIED" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

bankFormatConfigurationSchema.index({ bank: 1, currency: 1 }, { unique: true });

bankFormatConfigurationSchema.pre("save", function invalidateChangedCertification(next) {
  if (!this.isNew && ["bank", "currency", "mode", "specificationVersion", "bbva"].some(field => this.isModified(field))) {
    this.certified = false;
    this.certifiedAt = null;
    this.certifiedBy = null;
    this.certificationReference = "";
  }
  next();
});

export default mongoose.model("BankFormatConfiguration", bankFormatConfigurationSchema);
