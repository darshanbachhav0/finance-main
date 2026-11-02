import mongoose from "mongoose";
import { BANK_ACCOUNT_SCOPES, FOREIGN_BANK_CODE, foreignAccountProblems } from "../../../shared/supplierRegistration.mjs";
import {
  BANK_ACCOUNT_OWNERSHIP_RESULTS,
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  BENEFICIARY_BANKS,
  CURRENCY,
  SUPPLIER_ACCOUNT_TYPES
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
    // NATIONAL: a Peruvian bank (account number + 20-digit CCI). FOREIGN: a bank abroad, paid by
    // SWIFT transfer in USD; bank holds "FOREIGN" and bankOtherName the bank's name.
    scope: { type: String, enum: BANK_ACCOUNT_SCOPES, default: "NATIONAL" },
    bank: { type: String, enum: [...BENEFICIARY_BANKS, FOREIGN_BANK_CODE], required: true },
    foreign: {
      swift: { type: String, trim: true, uppercase: true },
      iban: { type: String, trim: true, uppercase: true },
      aba: { type: String, trim: true },
      bankCountry: { type: String, trim: true },
      bankCity: { type: String, trim: true },
      bankAddress: { type: String, trim: true },
      intermediaryBank: { type: String, trim: true },
      intermediarySwift: { type: String, trim: true, uppercase: true }
    },
    // The bank's name when it is not in the list (bank OTHER, "Otro / No disponible").
    bankOtherName: { type: String, trim: true, default: "" },
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
  if (this.scope === "FOREIGN") {
    // Accounts abroad carry SWIFT/IBAN/ABA instead of a CCI (shared/supplierRegistration.mjs).
    const problems = foreignAccountProblems({ ...(this.foreign || {}), bankOtherName: this.bankOtherName, accountNumber: this.accountNumber, currency: this.currency });
    if (problems.length) this.invalidate("foreign", problems.join(" "));
    this.cci = "";
  } else if (this.legacyImported) {
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
  if (this.scope === "FOREIGN" && this.bank !== FOREIGN_BANK_CODE) this.invalidate("bank", "An account abroad is not a Peruvian bank account.");
  if (this.scope !== "FOREIGN" && this.bank === FOREIGN_BANK_CODE) this.invalidate("bank", "Choose the Peruvian bank.");
  if (["OTHER", FOREIGN_BANK_CODE].includes(this.bank) && !this.bankOtherName) {
    this.invalidate("bankOtherName", "Enter the name of the bank.");
  }
  if (!["OTHER", FOREIGN_BANK_CODE].includes(this.bank)) this.bankOtherName = "";
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
