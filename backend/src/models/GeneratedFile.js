import mongoose from "mongoose";
import { nextDocumentNumber } from "../services/sequenceService.js";

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
    // DOC-YYYY-#####, in the order files are generated, whatever their kind. Older files get theirs
    // from the platform-improvements migration.
    documentNumber: { type: String, trim: true, unique: true, sparse: true, immutable: true },
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

generatedFileSchema.pre("save", async function assignDocumentNumber() {
  if (!this.documentNumber) this.documentNumber = await nextDocumentNumber(this.createdAt || new Date(), { session: this.$session() || undefined });
});

generatedFileSchema.index({ kind: 1, createdAt: -1 });

const GeneratedFile = mongoose.model("GeneratedFile", generatedFileSchema);
export default GeneratedFile;
