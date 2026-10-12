import mongoose from "mongoose";

// One backup of the database and stored files (services/backupService.js), started from the
// command line (npm run backup) or by the Super Admin.
const backupRunSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["RUNNING", "SUCCEEDED", "FAILED"], required: true, default: "RUNNING" },
    trigger: { type: String, enum: ["SUPER_ADMIN", "COMMAND"], required: true },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    triggeredByName: String,
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: Date,
    location: String,
    database: String,
    collections: [{ name: String, count: Number }],
    documentCount: Number,
    sizeBytes: Number,
    storage: { uploads: Boolean, generated: Boolean },
    error: String
  },
  { timestamps: true }
);

backupRunSchema.index({ startedAt: -1 });

export default mongoose.model("BackupRun", backupRunSchema);
