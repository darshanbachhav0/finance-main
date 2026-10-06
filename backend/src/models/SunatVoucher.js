import mongoose from "mongoose";
import { CURRENCY, FLOW_TYPES, VOUCHER_VALIDATION_STATUSES } from "../utils/constants.js";
import { canonicalSeries, canonicalVoucherNumber, canonicalVoucherType, sunatDocumentTypeCode } from "../utils/voucherIdentity.js";

const sunatVoucherSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "MassUploadBatch", index: true },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
    supersededAt: Date,
    supersededByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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
    validationEvidence: mongoose.Schema.Types.Mixed,
    sunatResponseReference: String,
    xmlPath: { type: String, select: false },
    xmlUrl: String,
    pdfPath: { type: String, select: false },
    pdfUrl: String,
    xmlChecksum: String,
    validatedAt: Date,
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provisionedAt: Date,
    // Populated only when validationStatus === "MANUAL_EXCEPTION": an explicit, audited human
    // override of automated SUNAT validation. This is never authoritative SUNAT validation and
    // is never set by the automatic validation path - only by the dedicated manual-override action.
    manualOverride: {
      reason: String,
      evidenceReference: String,
      overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      overriddenAt: Date,
      previousValidationStatus: String,
      // Taxpayer status could not be confirmed because SUNAT/Padrón was unavailable.
      taxpayerUnverified: Boolean
    },
    // SUNAT Tabla 10 code of voucherType ("01" factura, "03" boleta, "07" credit note, "08" debit note).
    documentTypeCode: { type: String, trim: true },
    // Credit/debit notes: the invoice they modify, from the XML BillingReference or chosen by the user.
    referencedVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher", index: true },
    referenceVoucherType: { type: String, trim: true, uppercase: true },
    referenceSeriesNumber: { type: String, trim: true, uppercase: true },
    adjustmentAppliedAt: Date,
    // Set when the CXP backed by this voucher is cancelled; the identity can then be registered again.
    annulment: {
      reason: String,
      accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
      at: Date,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    annulmentHistory: [mongoose.Schema.Types.Mixed]
  },
  { timestamps: true }
);

sunatVoucherSchema.pre("validate", function normalizeIdentity() {
  this.rucIssuer = String(this.rucIssuer || "").replace(/\D/g, "");
  this.voucherType = canonicalVoucherType(this.voucherType);
  this.documentTypeCode = sunatDocumentTypeCode(this.voucherType) || this.documentTypeCode;
  this.series = canonicalSeries(this.series);
  this.number = canonicalVoucherNumber(this.number);
  this.seriesNumber = `${this.series}-${this.number}`;
});

sunatVoucherSchema.index(
  { rucIssuer: 1, voucherType: 1, seriesNumber: 1 },
  { unique: true, name: "sunat_voucher_unique" }
);
sunatVoucherSchema.index({ purchaseOrder: 1, validationStatus: 1, issueDate: 1 });
sunatVoucherSchema.index({ batch: 1, validationStatus: 1 });

export default mongoose.model("SunatVoucher", sunatVoucherSchema);
