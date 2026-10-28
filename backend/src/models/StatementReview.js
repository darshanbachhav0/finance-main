import mongoose from "mongoose";
const lineSchema = new mongoose.Schema({
  date: Date,
  reference: { type: String, required: true },
  description: String,
  amount: Number,
  currency: { type: String, enum: ["PEN", "USD"] },
  matchStatus: { type: String, enum: ["UNMATCHED", "SUGGESTED", "AMBIGUOUS"], required: true },
  suggestedBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
  reviewDecision: { type: String, enum: ["PENDING", "ACCEPT", "UNIDENTIFIED", "REJECT"], default: "PENDING" },
  reviewNotes: { type: String, maxlength: 600 },
  candidates: [String]
}, { _id: false });
const reviewSchema = new mongoose.Schema({
  checksum: { type: String, required: true, unique: true, immutable: true },
  sourceName: { type: String, required: true },
  bankName: { type: String, trim: true, required: true },
  lines: [lineSchema],
  status: { type: String, enum: ["PENDING_ACCOUNTING", "READY_FOR_ACCOUNTING", "REVIEWED"], default: "PENDING_ACCOUNTING" },
  importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  preparedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date,
  reviewNotes: { type: String, maxlength: 1000 }
}, { timestamps: true });
reviewSchema.index({ createdAt: -1 });
export default mongoose.model("StatementReview", reviewSchema);
