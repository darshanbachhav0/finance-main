import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    role: String,
    ip: String,
    module: { type: String, required: true, default: "SYSTEM", index: true },
    entity: { type: String, required: true, default: "Unknown" },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.Mixed, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", index: true },
    requestNumber: String,
    action: { type: String, required: true },
    message: String,
    comments: String,
    oldValues: { type: mongoose.Schema.Types.Mixed },
    newValues: { type: mongoose.Schema.Types.Mixed },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    blocked: { type: Boolean, default: false },
    blockReason: String,
    period: String
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function immutable(next) {
  next(new Error("Audit records are append-only and cannot be changed or deleted."));
}

auditLogSchema.pre("save", function preventAuditMutation(next) {
  if (!this.isNew) return immutable(next);
  next();
});

for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  auditLogSchema.pre(operation, immutable);
}

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ requestId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, action: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
