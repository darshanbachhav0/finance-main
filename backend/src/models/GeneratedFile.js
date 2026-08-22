import mongoose from "mongoose";

const totalSchema = new mongoose.Schema(
  {
    currency: { type: String, required: true },
    total: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  { _id: false }
);

const generatedFileSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["BANK_TXT", "CONSOLIDATION_CSV", "SIRE_CSV", "MANAGEMENT_CSV"],
      required: true,
      index: true
    },
    fileName: { type: String, required: true },
    url: { type: String, required: true },
    period: String,
    requestIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest" }],
    requestNumbers: [String],
    totals: [totalSchema],
    rowCount: { type: Number, default: 0 },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

generatedFileSchema.index({ kind: 1, createdAt: -1 });

const GeneratedFile = mongoose.model("GeneratedFile", generatedFileSchema);
export default GeneratedFile;
