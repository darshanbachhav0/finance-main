import mongoose from "mongoose";
import { BANKS, CURRENCY } from "../utils/constants.js";

const bankFormatConfigurationSchema = new mongoose.Schema(
  {
    bank: { type: String, enum: BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true },
    mode: { type: String, enum: ["DEMO", "CERTIFIED"], default: "DEMO" },
    specificationVersion: { type: String, required: true, default: "UMA-DEMO-1" },
    certified: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: "DEMO / NOT CERTIFIED" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

bankFormatConfigurationSchema.index({ bank: 1, currency: 1 }, { unique: true });

export default mongoose.model("BankFormatConfiguration", bankFormatConfigurationSchema);

