import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: { type: String },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scope: { type: String, required: true },
  recordId: { type: String, default: "new" },
  route: { type: String, required: true },
  title: { type: String, required: true },
  revision: { type: Number, default: 0 },
  mutationId: String,
  sourceVersion: String,
  payload: { type: Buffer, select: false },
  closed: { type: Boolean, default: false }
}, { timestamps: true });
schema.index({ owner: 1, scope: 1, recordId: 1, updatedAt: -1 });
export default mongoose.model("WorkDraft", schema);
