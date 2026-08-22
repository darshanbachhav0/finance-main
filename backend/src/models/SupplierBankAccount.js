import mongoose from "mongoose";
import {
  BANK_ACCOUNT_OWNERSHIP_RESULTS,
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  CURRENCY,
  SUPPLIER_ACCOUNT_TYPES,
  SUPPLIER_BANKS
} from "../utils/constants.js";
import {
  assertValidBankAccountNumber,
  assertValidCci,
  normalizeBankAccountNumber,
  normalizeCci
} from "../utils/bankAccountValidation.js";

const supplierBankAccountSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    bank: { type: String, enum: SUPPLIER_BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true, default: "PEN" },
    accountType: { type: String, enum: SUPPLIER_ACCOUNT_TYPES, default: "CURRENT", required: true },
    accountHolderName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, required: true, trim: true },
    cci: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
    preferred: { type: Boolean, default: false },
    verificationStatus: { type: String, enum: BANK_ACCOUNT_VERIFICATION_STATUSES, default: "PENDING" },
    ownershipResult: { type: String, enum: BANK_ACCOUNT_OWNERSHIP_RESULTS, default: "NOT_REVIEWED" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: Date,
    verificationSource: { type: String, trim: true, default: "" },
    verificationDocument: { type: mongoose.Schema.Types.ObjectId },
    verificationComments: { type: String, trim: true, default: "" },
    validFrom: { type: Date, default: Date.now },
    validTo: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    legacyImported: { type: Boolean, default: false }
  },
  { timestamps: true }
);

supplierBankAccountSchema.pre("validate", function normalizeBankData() {
  if (this.legacyImported) {
    try {
      this.accountNumber = normalizeBankAccountNumber(this.accountNumber);
      this.cci = normalizeCci(this.cci);
    } catch {
      // Legacy rows stay readable and traceable; migration reports malformed values for review.
    }
  } else {
    this.accountNumber = assertValidBankAccountNumber(this.accountNumber);
    this.cci = assertValidCci(this.cci, { required: false });
  }
  if (this.validTo && this.validFrom && this.validTo < this.validFrom) {
    this.invalidate("validTo", "Valid-to date cannot be earlier than valid-from date.");
  }
  if (this.accountType === "DETRACTION" && this.bank !== "BANCO_NACION") {
    this.invalidate("bank", "Detraction accounts must use Banco de la Nacion.");
  }
  if (!this.active && this.preferred) {
    this.invalidate("preferred", "An inactive bank account cannot be preferred.");
  }
});

supplierBankAccountSchema.index({ supplier: 1, active: 1 });
supplierBankAccountSchema.index({ supplier: 1, active: 1, verificationStatus: 1, preferred: -1 });
supplierBankAccountSchema.index(
  { supplier: 1, currency: 1, accountType: 1, preferred: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, preferred: true },
    name: "one_active_preferred_supplier_account_per_currency_type"
  }
);
supplierBankAccountSchema.index({ accountNumber: 1 });
supplierBankAccountSchema.index({ cci: 1 }, { sparse: true });

export default mongoose.model("SupplierBankAccount", supplierBankAccountSchema);
