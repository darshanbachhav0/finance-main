import mongoose from "mongoose";
import {
  BANK_ACCOUNT_OWNERSHIP_RESULTS,
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  CURRENCY,
  SUPPLIER_ACCOUNT_TYPES,
  SUPPLIER_DECLARATION_ANSWERS,
  SUPPLIER_DELIVERY_METHODS,
  SUPPLIER_HOMOLOGATION_STATUSES,
  SUPPLIER_OPERATIONAL_STATUSES,
  SUPPLIER_PAYMENT_TERM_OPTIONS,
  SUPPLIER_PERSON_TYPES,
  SUPPLIER_REVIEW_RESULTS
} from "../utils/constants.js";

const bankHistorySchema = new mongoose.Schema(
  {
    bankName: String,
    currency: { type: String, enum: CURRENCY, default: "PEN" },
    accountType: { type: String, enum: SUPPLIER_ACCOUNT_TYPES, default: "CURRENT" },
    accountHolderName: String,
    bankAccount: String,
    cci: String,
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "INACTIVE" },
    preferred: { type: Boolean, default: false },
    verificationStatus: { type: String, enum: BANK_ACCOUNT_VERIFICATION_STATUSES, default: "PENDING" },
    ownershipResult: { type: String, enum: BANK_ACCOUNT_OWNERSHIP_RESULTS, default: "NOT_REVIEWED" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: Date,
    verificationSource: String,
    verificationDocument: { type: mongoose.Schema.Types.ObjectId },
    validFrom: { type: Date, default: Date.now },
    validTo: Date,
    changedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: true }
);

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    position: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" }
  },
  { _id: false }
);

const declarationSchema = new mongoose.Schema(
  {
    answer: { type: String, enum: SUPPLIER_DECLARATION_ANSWERS, default: "NOT_DECLARED" },
    comments: { type: String, trim: true, default: "" },
    declaredAt: Date
  },
  { _id: false }
);

const supplierDocumentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["RUC_FILE", "BANK_CERTIFICATE", "LEGAL_REP_ID"], required: true },
    originalName: String,
    filename: String,
    path: { type: String, select: false },
    url: String,
    mimetype: String,
    size: Number,
    checksum: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const supplierSchema = new mongoose.Schema(
  {
    supplierCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true, match: /^PRV-\d{4,}$/ },
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    proposedAt: Date,
    proposalJustification: { type: String, trim: true, default: "" },
    identifierType: { type: String, enum: ["RUC", "DNI"], required: true, default: "RUC" },
    personType: { type: String, enum: SUPPLIER_PERSON_TYPES },
    rucDni: { type: String, required: true, unique: true, trim: true },
    normalizedIdentifier: { type: String, unique: true, sparse: true, trim: true },
    legalName: { type: String, trim: true },
    commercialName: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    taxAddress: { type: String, trim: true },
    fiscalAddress: { type: String, trim: true },
    location: {
      district: { type: String, trim: true, default: "" },
      province: { type: String, trim: true, default: "" },
      department: { type: String, trim: true, default: "" },
      ubigeo: { type: String, trim: true, default: "" }
    },
    website: { type: String, trim: true, default: "" },
    legalRepresentative: { type: String, trim: true },
    legalRepresentativeDocument: {
      type: { type: String, enum: ["DNI", "CE"] },
      number: { type: String, trim: true, default: "" }
    },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    contactName: { type: String, trim: true },
    commercialContact: { type: contactSchema, default: () => ({}) },
    operationsContact: { type: contactSchema, default: () => ({}) },
    supplierType: { type: String, trim: true, default: "General" },
    goodsServicesProfile: { type: String, trim: true, default: "" },
    paymentTerms: {
      option: { type: String, enum: SUPPLIER_PAYMENT_TERM_OPTIONS },
      days: { type: Number, min: 0 },
      comments: { type: String, trim: true, default: "" }
    },
    delivery: {
      method: { type: String, enum: SUPPLIER_DELIVERY_METHODS },
      other: { type: String, trim: true, default: "" }
    },
    currency: { type: String, enum: CURRENCY, default: "PEN" },
    bankName: { type: String, trim: true },
    bankAccount: { type: String, trim: true },
    cci: { type: String, trim: true },
    taxpayerStatus: { type: String, enum: ["PENDING", "ACTIVE", "INACTIVE", "NOT_CONFIGURED", "MANUALLY_VALIDATED"], default: "PENDING" },
    taxpayerValidation: {
      status: { type: String, enum: ["NOT_VERIFIED", "VALID", "INVALID"], default: "NOT_VERIFIED" },
      providerMode: { type: String, enum: ["NOT_CONFIGURED", "MANUAL", "MOCK", "PRODUCTION"], default: "NOT_CONFIGURED" },
      providerConfigured: { type: Boolean, default: false },
      source: { type: String, trim: true, default: "" },
      returnedIdentifier: { type: String, trim: true, default: "" },
      returnedLegalName: { type: String, trim: true, default: "" },
      identifierMatch: { type: String, enum: ["MATCH", "MISMATCH", "NOT_VERIFIED"], default: "NOT_VERIFIED" },
      legalNameMatch: { type: String, enum: ["MATCH", "MISMATCH", "NOT_VERIFIED"], default: "NOT_VERIFIED" },
      validatedAt: Date,
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: { type: String, trim: true, default: "" }
    },
    complianceStatus: { type: String, enum: ["PENDING", "COMPLIANT", "NON_COMPLIANT", "OBSERVED"], default: "PENDING" },
    homologationStatus: { type: String, enum: SUPPLIER_HOMOLOGATION_STATUSES, default: "PENDING_VALIDATION", index: true },
    active: { type: Boolean, default: false },
    status: { type: String, enum: SUPPLIER_OPERATIONAL_STATUSES, default: "PENDING_VALIDATION" },
    declarations: {
      stateSanctions: { type: declarationSchema, default: () => ({}) },
      complianceModel: { type: declarationSchema, default: () => ({}) }
    },
    complianceReview: {
      result: { type: String, enum: SUPPLIER_REVIEW_RESULTS, default: "PENDING" },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewedAt: Date,
      comments: { type: String, trim: true, default: "" }
    },
    compliance: {
      taxpayerActive: { type: Boolean, default: false },
      compliant: { type: Boolean, default: false },
      validatedAt: Date,
      validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewComments: String,
    documents: [supplierDocumentSchema],
    bankHistory: [bankHistorySchema]
  },
  { timestamps: true }
);

supplierSchema.pre("validate", function normalizeSupplier() {
  this.normalizedIdentifier = String(this.rucDni || "").replace(/\D/g, "");
  this.identifierType = this.normalizedIdentifier.length === 8 ? "DNI" : "RUC";
  this.legalName ||= this.name;
  this.name ||= this.legalName;
  this.commercialName ||= this.name;
  this.taxAddress ||= this.fiscalAddress;
  this.fiscalAddress ||= this.taxAddress;
  if (this.paymentTerms?.option === "CREDIT_30") this.paymentTerms.days = 30;
  if (this.paymentTerms?.option === "CREDIT_45") this.paymentTerms.days = 45;
  if (this.paymentTerms?.option === "CUSTOM" && !(this.paymentTerms.days > 0)) {
    this.invalidate("paymentTerms.days", "Custom payment terms require a positive number of days.");
  }
});

supplierSchema.pre("save", async function protectAssignedSupplierCode() {
  if (this.isNew || !this.isModified("supplierCode")) return;
  const stored = await this.constructor.findById(this._id).select("supplierCode").lean();
  if (stored?.supplierCode && stored.supplierCode !== this.supplierCode) {
    throw new Error("Supplier code is immutable after assignment.");
  }
});

supplierSchema.index({ active: 1, homologationStatus: 1, name: 1 });
supplierSchema.index({ proposedBy: 1, homologationStatus: 1, createdAt: -1 });

export default mongoose.model("Supplier", supplierSchema);
