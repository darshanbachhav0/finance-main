import mongoose from "mongoose";
const schema = new mongoose.Schema({
  _id: { type: String, default: "workflow" },
  reminderHours: { type: Number, default: 24, min: 1, max: 720 },
  escalationHours: { type: Number, default: 72, min: 1, max: 2160 },
  remindersEnabled: { type: Boolean, default: true },
  cursor: Date, lastFullScan: Date, leaseUntil: Date, leaseOwner: String,
  lastSuccess: Date, lastError: String
}, { timestamps: true });
export default mongoose.model("WorkflowControl", schema);
