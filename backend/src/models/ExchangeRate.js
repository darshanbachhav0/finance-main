import mongoose from "mongoose";

const exchangeRateSchema = new mongoose.Schema(
  {
    currency: { type: String, enum: ["USD"], default: "USD", required: true },
    quoteCurrency: { type: String, enum: ["PEN"], default: "PEN", required: true },
    date: { type: Date, required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    rate: { type: Number, required: true, min: 0 },
    source: { type: String, default: "MANUAL" },
    sourceLabel: { type: String, default: "Authorized manual selling rate" },
    providerMode: { type: String, enum: ["MANUAL", "BCRP_FALLBACK", "MOCK", "SUNAT"], default: "MANUAL" },
    authoritative: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

exchangeRateSchema.index({ currency: 1, date: 1 }, { unique: true });
exchangeRateSchema.index({ currency: 1, period: 1, date: -1 });

export default mongoose.model("ExchangeRate", exchangeRateSchema);
