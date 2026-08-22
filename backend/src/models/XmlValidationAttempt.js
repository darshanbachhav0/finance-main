import mongoose from "mongoose";

const xmlValidationAttemptSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest" },
    requestNumber: String,
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    attemptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fileName: String,
    checksum: String,
    status: { type: String, enum: ["VALID", "INVALID"], required: true },
    result: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

xmlValidationAttemptSchema.index({ request: 1, createdAt: -1 });
xmlValidationAttemptSchema.index({ supplier: 1, status: 1, createdAt: -1 });

export default mongoose.model("XmlValidationAttempt", xmlValidationAttemptSchema);

