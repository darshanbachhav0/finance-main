import mongoose from "mongoose";

const accountingPeriodSchema = new mongoose.Schema(
  {
    period: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
    openedAt: { type: Date, default: Date.now },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    closedAt: Date,
    closingDate: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reopenedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    comments: { type: String, trim: true },
    policy: {
      blockCreate: { type: Boolean, default: true },
      blockUpdate: { type: Boolean, default: true },
      blockDelete: { type: Boolean, default: true },
      blockApproval: { type: Boolean, default: true },
      blockPosting: { type: Boolean, default: true },
      blockPayment: { type: Boolean, default: true },
      blockRendition: { type: Boolean, default: true },
      blockVoid: { type: Boolean, default: true },
      blockClose: { type: Boolean, default: true }
    },
    history: [{
      action: { type: String, enum: ["CREATED", "CLOSED", "REOPENED"], required: true },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String,
      override: { type: Boolean, default: false }
    }]
  },
  { timestamps: true }
);

export default mongoose.model("AccountingPeriod", accountingPeriodSchema);
