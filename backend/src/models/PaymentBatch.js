import mongoose from "mongoose";
import { SOURCE_BANKS, CURRENCY } from "../utils/constants.js";

const paymentItemSchema = new mongoose.Schema(
  {
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable", required: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true },
    requestNumber: { type: String, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierIdentifier: { type: String, required: true },
    supplierName: { type: String, required: true },
    bankAccount: {
      sourceType: String,
      bankAccountId: mongoose.Schema.Types.ObjectId,
      employeeBankAccountId: mongoose.Schema.Types.ObjectId,
      bank: String,
      currency: String,
      accountType: String,
      accountHolderName: String,
      accountNumber: String,
      cci: String,
      validFrom: Date,
      verificationStatus: String,
      ownershipResult: String,
      capturedAt: Date
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    priority: { type: String, enum: ["NORMAL", "PRIORITY"], default: "NORMAL" },
    status: { type: String, enum: ["INSTRUCTION_CREATED", "CONFIRMED", "REJECTED", "REPROGRAMMED", "CANCELLED"], default: "INSTRUCTION_CREATED" },
    rejection: {
      reason: String,
      bankReference: String,
      rejectedAt: Date,
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    }
  },
  { _id: true }
);

const paymentBatchSchema = new mongoose.Schema(
  {
    batchNumber: { type: String, required: true, unique: true, immutable: true },
    bank: { type: String, enum: SOURCE_BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true },
    paymentDate: { type: Date, required: true },
    items: { type: [paymentItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true, select: false },
    url: { type: String, required: true },
    checksum: { type: String, required: true },
    adapterMode: { type: String, enum: ["DEMO", "CERTIFIED", "FIXED_WIDTH"], default: "DEMO" },
    paymentCount: Number,
    formatSnapshot: mongoose.Schema.Types.Mixed,
    specificationVersion: { type: String, default: "DEMO-1" },
    // Immutable snapshot of the BankFormatConfiguration's certification state at the moment this
    // file was generated. A later certification decision on the configuration must never change
    // what an already-generated batch reports as its certification state.
    certificationSnapshot: {
      certified: { type: Boolean, default: false },
      certifiedAt: { type: Date, default: null },
      certifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      certificationReference: { type: String, default: "" },
      specificationVersion: String
    },
    priority: { type: String, enum: ["NORMAL", "PRIORITY", "MIXED"], default: "NORMAL", index: true },
    status: { type: String, enum: ["GENERATED", "PARTIALLY_CONFIRMED", "CONFIRMED", "REJECTED", "REPROGRAMMED", "CANCELLED"], default: "GENERATED", index: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

paymentBatchSchema.index({ status: 1, paymentDate: 1 });
paymentBatchSchema.index({ bank: 1, currency: 1, generatedAt: -1 });

export default mongoose.model("PaymentBatch", paymentBatchSchema);
