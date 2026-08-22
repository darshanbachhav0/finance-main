import mongoose from "mongoose";
import { CURRENCY, FLOW_TYPE } from "../utils/constants.js";

export const INVOICE_OBSERVATION_STATUSES = Object.freeze([
  "OBSERVED_SUNAT",
  "OBSERVED_DUPLICATE",
  "OBSERVED_AMOUNT_EXCEEDED",
  "OBSERVED_BATCH",
  "FAILED"
]);

const attemptSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: INVOICE_OBSERVATION_STATUSES, required: true },
    errorCode: String,
    detail: String,
    xmlChecksum: String
  },
  { _id: false }
);

const invoiceObservationSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "MassUploadBatch", required: true, index: true },
    batchItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    flowType: { type: String, enum: [FLOW_TYPE.A2], default: FLOW_TYPE.A2, immutable: true },
    sourceType: { type: String, enum: ["ZIP", "EXCEL"], required: true },
    sourceName: { type: String, trim: true, required: true },
    rucIssuer: { type: String, trim: true, uppercase: true },
    voucherType: { type: String, trim: true, uppercase: true, default: "FACTURA" },
    series: { type: String, trim: true, uppercase: true },
    number: { type: String, trim: true, uppercase: true },
    seriesNumber: { type: String, trim: true, uppercase: true },
    issueDate: Date,
    currency: { type: String, enum: CURRENCY },
    netAmount: { type: Number, min: 0 },
    igvAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },
    status: { type: String, enum: INVOICE_OBSERVATION_STATUSES, required: true, index: true },
    errorCode: { type: String, trim: true },
    errorDetail: { type: String, trim: true, required: true },
    duplicateVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    xmlPath: { type: String, select: false },
    xmlUrl: String,
    xmlChecksum: String,
    pdfPath: { type: String, select: false },
    pdfUrl: String,
    resolutionStatus: { type: String, enum: ["OPEN", "RESOLVED", "DISMISSED"], default: "OPEN", index: true },
    attemptCount: { type: Number, default: 1, min: 1 },
    lastAttemptAt: { type: Date, default: Date.now },
    attempts: { type: [attemptSchema], default: [] },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolutionComments: String
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

invoiceObservationSchema.pre("validate", function normalizeIdentity() {
  this.rucIssuer = String(this.rucIssuer || "").replace(/\D/g, "");
  this.voucherType = String(this.voucherType || "FACTURA").trim().toUpperCase();
  this.series = String(this.series || "").trim().toUpperCase();
  this.number = String(this.number || "").trim().toUpperCase();
  this.seriesNumber = this.series || this.number ? `${this.series}-${this.number}`.replace(/^-|-$/g, "") : "";
});

invoiceObservationSchema.virtual("validationStatus").get(function validationStatus() { return this.status; });
invoiceObservationSchema.virtual("observationDetail").get(function observationDetail() { return this.errorDetail; });
invoiceObservationSchema.virtual("xmlAmount").get(function xmlAmount() { return this.totalAmount; });

invoiceObservationSchema.index({ batch: 1, batchItemId: 1 }, { unique: true, name: "batch_item_observation_unique" });
invoiceObservationSchema.index({ resolutionStatus: 1, status: 1, updatedAt: -1 });
invoiceObservationSchema.index({ rucIssuer: 1, voucherType: 1, seriesNumber: 1, resolutionStatus: 1 });

export default mongoose.model("InvoiceObservation", invoiceObservationSchema);
