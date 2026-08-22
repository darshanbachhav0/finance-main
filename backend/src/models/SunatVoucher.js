import mongoose from "mongoose";
import { CURRENCY, FLOW_TYPES, VOUCHER_VALIDATION_STATUSES } from "../utils/constants.js";

const sunatVoucherSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "MassUploadBatch", index: true },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    flowType: { type: String, enum: FLOW_TYPES, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    rucIssuer: { type: String, required: true, trim: true, uppercase: true },
    voucherType: { type: String, required: true, trim: true, uppercase: true },
    series: { type: String, required: true, trim: true, uppercase: true },
    number: { type: String, required: true, trim: true, uppercase: true },
    seriesNumber: { type: String, required: true, trim: true, uppercase: true },
    issueDate: Date,
    currency: { type: String, enum: CURRENCY },
    netAmount: { type: Number, min: 0 },
    igvAmount: { type: Number, min: 0 },
    xmlAmount: { type: Number, required: true, min: 0 },
    validationStatus: { type: String, enum: VOUCHER_VALIDATION_STATUSES, default: "PENDING", index: true },
    observationDetail: String,
    sunatStatus: String,
    taxpayerStatus: String,
    sunatProvider: String,
    sunatResponseReference: String,
    xmlPath: { type: String, select: false },
    xmlUrl: String,
    pdfPath: { type: String, select: false },
    pdfUrl: String,
    xmlChecksum: String,
    validatedAt: Date,
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provisionedAt: Date
  },
  { timestamps: true }
);

sunatVoucherSchema.pre("validate", function normalizeIdentity() {
  this.rucIssuer = String(this.rucIssuer || "").replace(/\D/g, "");
  this.voucherType = String(this.voucherType || "FACTURA").trim().toUpperCase();
  this.series = String(this.series || "").trim().toUpperCase();
  this.number = String(this.number || "").trim().toUpperCase();
  this.seriesNumber = `${this.series}-${this.number}`;
});

sunatVoucherSchema.index(
  { rucIssuer: 1, voucherType: 1, seriesNumber: 1 },
  { unique: true, name: "sunat_voucher_unique" }
);
sunatVoucherSchema.index({ purchaseOrder: 1, validationStatus: 1, issueDate: 1 });
sunatVoucherSchema.index({ batch: 1, validationStatus: 1 });

export default mongoose.model("SunatVoucher", sunatVoucherSchema);
