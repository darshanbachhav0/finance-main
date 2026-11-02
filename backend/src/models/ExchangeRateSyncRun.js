import mongoose from "mongoose";

// One automatic (or requested) synchronization of the official SBS exchange rates: which sources
// answered, what was stored, and why a source failed. Kept for the exchange-rate page and audits.
const sourceResultSchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    status: { type: String, enum: ["OK", "FAILED"], required: true },
    attempts: { type: Number, default: 1 },
    received: { type: Number, default: 0 },
    latestDate: String,
    error: String
  },
  { _id: false }
);

const exchangeRateSyncRunSchema = new mongoose.Schema(
  {
    trigger: { type: String, enum: ["SCHEDULE", "STARTUP", "MANUAL", "ON_DEMAND"], required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    status: { type: String, enum: ["OK", "PARTIAL", "FAILED"], required: true },
    sources: { type: [sourceResultSchema], default: [] },
    inserted: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    // The latest official rate after the run: its applicable date and how far behind today it is.
    latestDate: String,
    stale: { type: Boolean, default: false },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

exchangeRateSyncRunSchema.index({ startedAt: -1 });

export default mongoose.model("ExchangeRateSyncRun", exchangeRateSyncRunSchema);
