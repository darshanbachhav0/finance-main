import mongoose from "mongoose";
import { paymentTermFields } from "./paymentTermFields.js";
import { AP_STATUS, CURRENCY, FLOW_TYPES, PAYMENT_DESTINATION_SOURCES, SUPPLIER_PAYMENT_TERM_OPTIONS } from "../utils/constants.js";

const accountsPayableSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder", index: true },
    sunatVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher", index: true },
    sourceBatch: { type: mongoose.Schema.Types.ObjectId, ref: "MassUploadBatch", index: true },
    flowType: { type: String, enum: FLOW_TYPES },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierIdentifierSnapshot: { type: String, required: true },
    beneficiarySnapshot: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      employeeCode: String,
      name: String,
      email: String
    },
    voucher: {
      voucherType: String,
      documentType: String,
      series: String,
      number: String,
      documentDate: Date
    },
    originalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    exchangeRate: { type: Number, required: true, min: 0 },
    exchangeRateEvidence: mongoose.Schema.Types.Mixed,
    penEquivalent: { type: Number, required: true, min: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    dueDate: Date,
    paymentPriority: { type: String, enum: ["NORMAL", "PRIORITY"], default: "NORMAL", index: true },
    budgetExecutedAt: Date,
    budgetPaidAt: Date,
    paymentTermsSnapshot: {
      ...paymentTermFields,
      source: { type: String, enum: ["PURCHASE_ORDER", "QUOTATION", "SUPPLIER_DEFAULT"] },
      sourceQuotation: mongoose.Schema.Types.ObjectId,
      quotationAmount: Number,
      quotationCurrency: { type: String, enum: CURRENCY },
      option: { type: String, enum: SUPPLIER_PAYMENT_TERM_OPTIONS },
      days: { type: Number, min: 0 },
      supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
      capturedAt: Date
    },
    status: { type: String, enum: Object.values(AP_STATUS), default: AP_STATUS.OPEN, index: true },
    provisionJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    paymentJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
    // Every payment-side journal (one per confirmed installment and one per detraccion deposit);
    // paymentJournal keeps pointing at the latest for backward compatibility.
    paymentJournals: [{ type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" }],
    paymentBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
    bankAccountSnapshot: {
      sourceType: { type: String, enum: PAYMENT_DESTINATION_SOURCES },
      bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierBankAccount" },
      employeeBankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeReimbursementBankAccount" },
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
    scheduledFor: Date,
    // Payments follow the university cycle (15th / 30th). A date off that cycle needs an audited reason.
    scheduleOverride: {
      reason: String,
      cycleDate: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: Date
    },
    // SPOT detraccion. UMA is not an IGV withholding agent, so there is no retention - only the
    // detraccion deposit to the supplier's Banco de la Nacion account when the good/service is
    // subject to SPOT. The CXP is PAID only after both the net transfer and the deposit.
    detraction: {
      status: { type: String, enum: ["NOT_APPLICABLE", "PENDING", "DEPOSITED"] },
      categoryCode: String,
      categoryDescription: String,
      rate: Number,
      minimumAmount: Number,
      baseAmountPen: Number,
      amount: Number,
      amountPen: Number,
      determinedAt: Date,
      beneficiaryAccountNumber: String,
      constancyNumber: String,
      depositDate: Date,
      depositedAt: Date,
      depositedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" }
    },
    reconciliation: { type: mongoose.Schema.Types.ObjectId, ref: "Reconciliation" },
    reconciledAt: Date,
    paidDate: Date,
    bouncedPayment: {
      bouncedAt: Date,
      reason: String,
      // BANK_DETAILS: incorrect/invalid/changed/unverified beneficiary data - needs a signed CCI
      // letter and the bounced account is flagged until re-verified. TECHNICAL: a temporary bank
      // problem - Treasury may retry on the still-verified account without a new letter.
      reasonCategory: { type: String, enum: ["BANK_DETAILS", "TECHNICAL"] },
      flaggedAccount: {
        sourceType: String,
        accountId: { type: mongoose.Schema.Types.ObjectId }
      },
      bankReference: String,
      reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reprogrammedAt: Date,
      reprogrammedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      replacementBankDocument: { type: mongoose.Schema.Types.ObjectId }
    },
    history: [{ status: String, at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, comments: String }]
  },
  { timestamps: true }
);

accountsPayableSchema.index({ status: 1, dueDate: 1 });
accountsPayableSchema.index({ supplier: 1, status: 1 });
accountsPayableSchema.index({ request: 1, createdAt: 1 });
accountsPayableSchema.index({ purchaseOrder: 1, status: 1, createdAt: 1 });
accountsPayableSchema.index(
  {
    supplierIdentifierSnapshot: 1,
    "voucher.voucherType": 1,
    "voucher.series": 1,
    "voucher.number": 1
  },
  {
    unique: true,
    partialFilterExpression: {
      supplierIdentifierSnapshot: { $type: "string" },
      "voucher.voucherType": { $type: "string" },
      "voucher.series": { $type: "string" },
      "voucher.number": { $type: "string" }
    },
    name: "accounts_payable_voucher_unique"
  }
);

export default mongoose.model("AccountsPayable", accountsPayableSchema);
