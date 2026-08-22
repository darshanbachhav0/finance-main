import mongoose from "mongoose";

const migrationRunSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    appliedAt: { type: Date, required: true, default: Date.now },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    reportFile: String
  },
  { timestamps: true }
);

export default mongoose.model("MigrationRun", migrationRunSchema);

