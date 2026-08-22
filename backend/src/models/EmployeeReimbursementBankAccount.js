import mongoose from "mongoose";
import {
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  CURRENCY,
  SUPPLIER_BANKS
} from "../utils/constants.js";
import {
  assertValidBankAccountNumber,
  assertValidCci
} from "../utils/bankAccountValidation.js";

const employeeReimbursementBankAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    bank: { type: String, enum: SUPPLIER_BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true, default: "PEN" },
    accountHolderName: { type: String, required: true, trim: true, select: false },
    accountNumber: { type: String, required: true, trim: true, select: false },
    cci: { type: String, trim: true, default: "", select: false },
    active: { type: Boolean, default: true },
    preferred: { type: Boolean, default: false },
    verificationStatus: { type: String, enum: BANK_ACCOUNT_VERIFICATION_STATUSES, default: "PENDING" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: Date,
    verificationSource: { type: String, trim: true, default: "" },
    verificationDocument: { type: mongoose.Schema.Types.ObjectId },
    validFrom: { type: Date, default: Date.now },
    validTo: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

employeeReimbursementBankAccountSchema.pre("validate", function normalizeBankData() {
  this.accountNumber = assertValidBankAccountNumber(this.accountNumber);
  this.cci = assertValidCci(this.cci, { required: false });
  if (this.validTo && this.validFrom && this.validTo < this.validFrom) {
    this.invalidate("validTo", "Valid-to date cannot be earlier than valid-from date.");
  }
});

employeeReimbursementBankAccountSchema.index({ user: 1, active: 1, validFrom: -1 });
employeeReimbursementBankAccountSchema.index(
  { user: 1, preferred: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, preferred: true },
    name: "one_active_preferred_employee_reimbursement_account"
  }
);

export default mongoose.model("EmployeeReimbursementBankAccount", employeeReimbursementBankAccountSchema);
