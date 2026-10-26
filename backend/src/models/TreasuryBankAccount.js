import mongoose from "mongoose";
import { BENEFICIARY_BANKS, CURRENCY, TREASURY_ACCOUNT_KINDS } from "../utils/constants.js";

// UMA's own bank accounts: the source and destination of a Track D transfer (traspaso). Each one
// names the class-10 ledger account its movements post to (e.g. 104101 BBVA soles). Maintained by
// Treasury and Admin; deactivated, never deleted.
const treasuryBankAccountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, match: /^[A-Z0-9-]{2,30}$/ },
    bank: { type: String, enum: BENEFICIARY_BANKS, required: true },
    currency: { type: String, enum: CURRENCY, required: true },
    accountNumber: { type: String, required: true, trim: true },
    cci: { type: String, trim: true, default: "", match: /^(\d{20})?$/ },
    ledgerAccount: { type: String, required: true, trim: true, match: /^10\d{2,6}$/ },
    kind: { type: String, enum: TREASURY_ACCOUNT_KINDS, default: "OPERATING" },
    description: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

treasuryBankAccountSchema.index({ active: 1, currency: 1 });

export default mongoose.model("TreasuryBankAccount", treasuryBankAccountSchema);
