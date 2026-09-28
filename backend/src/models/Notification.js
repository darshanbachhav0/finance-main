import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    eventKey: { type: String, required: true },
    type: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    // Translatable copy: English templates with {placeholders} and their values.
    titleKey: String,
    messageKey: String,
    params: { type: mongoose.Schema.Types.Mixed },
    path: { type: String, trim: true },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    readAt: Date,
    resolvedAt: Date
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, eventKey: 1 }, { unique: true });
notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);

