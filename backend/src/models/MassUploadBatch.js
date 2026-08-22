import mongoose from "mongoose";
import { BATCH_UPLOAD_STATUSES } from "../utils/constants.js";

const batchFileSchema = new mongoose.Schema(
  {
    originalName: String,
    filename: String,
    path: { type: String, select: false },
    url: String,
    mimetype: String,
    size: Number,
    checksum: String
  },
  { _id: false }
);

const batchItemSchema = new mongoose.Schema(
  {
    sourceName: { type: String, trim: true },
    xmlFileName: String,
    pdfFileName: String,
    rucIssuer: String,
    voucherType: String,
    series: String,
    number: String,
    seriesNumber: String,
    issueDate: Date,
    currency: String,
    netAmount: Number,
    igvAmount: Number,
    totalAmount: Number,
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
    observation: { type: mongoose.Schema.Types.ObjectId, ref: "InvoiceObservation" },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    attemptCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "PROVISIONED", "OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH", "FAILED"],
      default: "QUEUED"
    },
    errorCode: String,
    errorDetail: String,
    processedAt: Date
  },
  { _id: true }
);

const massUploadBatchSchema = new mongoose.Schema(
  {
    batchCode: { type: String, required: true, unique: true, immutable: true, index: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    inputType: { type: String, enum: ["ZIP", "EXCEL"], required: true },
    inputFile: { type: batchFileSchema, required: true },
    status: { type: String, enum: BATCH_UPLOAD_STATUSES, default: "QUEUED", index: true },
    totalFiles: { type: Number, default: 0, min: 0 },
    totalVouchers: { type: Number, default: 0, min: 0 },
    processedSuccess: { type: Number, default: 0, min: 0 },
    observed: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    startedAt: Date,
    completedAt: Date,
    errorMessage: String,
    processingErrors: { type: [String], default: [] },
    items: { type: [batchItemSchema], default: [] }
  },
  { timestamps: true, optimisticConcurrency: true }
);

massUploadBatchSchema.index({ status: 1, createdAt: 1 });
massUploadBatchSchema.index({ purchaseOrder: 1, createdAt: -1 });

export default mongoose.model("MassUploadBatch", massUploadBatchSchema);
