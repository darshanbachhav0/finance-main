import mongoose from "mongoose";

export const DELIVERY_CHANNELS = Object.freeze(["EMAIL"]);
export const DELIVERY_STATUSES = Object.freeze(["PENDING", "SENDING", "SENT", "SKIPPED", "FAILED"]);

// Outbox of notifications to deliver outside the bell (today: email). notifyUser() queues a row
// when a notification is new or comes back unread; the notification-email worker sends it after
// a short delay, so an alert already read in the app or already resolved is never emailed.
const notificationDeliverySchema = new mongoose.Schema(
  {
    notification: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    channel: { type: String, enum: DELIVERY_CHANNELS, required: true, default: "EMAIL" },
    status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "PENDING" },
    sendAfter: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    // A claimed batch: rows of one user taken together by one worker pass, sent as one email.
    claimToken: String,
    claimedAt: Date,
    sentAt: Date,
    skipReason: String,
    lastError: String,
    // Address the email went to (kept for support: "did I get it?").
    recipient: String
  },
  { timestamps: true }
);

// At most one waiting delivery per notification and channel: a notification re-armed again before
// its email went out is still one email (sent with the latest wording).
notificationDeliverySchema.index({ notification: 1, channel: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" }, name: "delivery_pending_unique" });
notificationDeliverySchema.index({ status: 1, sendAfter: 1 });
notificationDeliverySchema.index({ user: 1, status: 1, sendAfter: 1 });

export default mongoose.model("NotificationDelivery", notificationDeliverySchema);
