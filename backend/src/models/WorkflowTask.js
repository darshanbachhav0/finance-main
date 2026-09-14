import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  entityType: { type: String, required: true }, entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestId: mongoose.Schema.Types.ObjectId, owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reference: String, module: String, stage: String, team: String, action: String, path: String,
  sourceStatus: String, comments: String,
  eligibleUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, claimedAt: Date,
  status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
  revision: { type: Number, default: 1 }, waitingSince: Date, dueAt: Date, resolvedAt: Date,
  deliveryPending: { type: Boolean, default: true }, recipientSignature: String,
  lastReminderBucket: String, escalationKey: String,
  history: [{ action: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: Date, comments: String }]
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ entityType: 1, entityId: 1, status: 1 });
schema.index({ eligibleUsers: 1, status: 1, waitingSince: 1 });
schema.index({ owner: 1, status: 1 });
schema.index({ deliveryPending: 1 });
export default mongoose.model("WorkflowTask", schema);
