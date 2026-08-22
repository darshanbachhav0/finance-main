import mongoose from "mongoose";

const reconciliationSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    accountsPayables: [{ type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" }],
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reconciledAt: { type: Date, required: true, default: Date.now },
    bankReference: { type: String, required: true, trim: true },
    statementAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true },
    comments: { type: String, trim: true }
  },
  { timestamps: true }
);

reconciliationSchema.index({ reconciledAt: -1 });

export default mongoose.model("Reconciliation", reconciliationSchema);

