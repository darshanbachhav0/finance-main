import mongoose from "mongoose";

// One USD/PEN rate per date it applies to. Official rates (providerMode SBS) are written only by
// the automatic synchronization (services/exchangeRateSyncService.js) from the SBS publications
// read through SUNAT or BCRPData; a MANUAL rate is an explicit, audited entry that is used only
// when EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK is on and no official rate exists.
const exchangeRateSchema = new mongoose.Schema(
  {
    currency: { type: String, enum: ["USD"], default: "USD", required: true },
    quoteCurrency: { type: String, enum: ["PEN"], default: "PEN", required: true },
    // The date the rate applies to (SUNAT's table date): a document dated this day uses it.
    date: { type: Date, required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    // Selling rate (venta), kept as `rate` for every existing reader.
    rate: { type: Number, required: true, min: 0 },
    buyRate: { type: Number, min: 0 },
    sellRate: { type: Number, min: 0 },
    // The SBS close the value belongs to, when the source says so (BCRPData series date).
    sbsClosingDate: { type: Date },
    source: { type: String, default: "MANUAL" },
    sourceLabel: { type: String, default: "Authorized manual selling rate" },
    providerMode: { type: String, enum: ["MANUAL", "BCRP_FALLBACK", "MOCK", "SUNAT", "SBS"], default: "MANUAL" },
    authoritative: { type: Boolean, default: false },
    // The exact endpoint that was queried (evidence trail; not applicable to a manual entry).
    sourceUrl: { type: String, trim: true },
    // When this record's value was actually retrieved/entered, distinct from `date` (the rate's own
    // effective calendar date) and from `createdAt`.
    retrievedAt: { type: Date, default: Date.now },
    // Both official sources answered for this date with the same value.
    confirmedBy: { type: [String], default: undefined },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

exchangeRateSchema.pre("validate", function sellRateIsRate(next) {
  if (this.sellRate > 0 && this.rate !== this.sellRate) this.rate = this.sellRate;
  next();
});

exchangeRateSchema.index({ currency: 1, date: 1 }, { unique: true });
exchangeRateSchema.index({ currency: 1, period: 1, date: -1 });
exchangeRateSchema.index({ currency: 1, providerMode: 1, date: -1 });

export default mongoose.model("ExchangeRate", exchangeRateSchema);
