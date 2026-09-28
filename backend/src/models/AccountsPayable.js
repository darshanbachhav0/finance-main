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
    // Current payable amount: the invoice total adjusted by credit/debit notes applied to it.
    originalAmount: { type: Number, required: true, min: 0 },
    // Invoice total as registered, before any credit/debit note adjustment.
    invoiceAmount: { type: Number, min: 0 },
    // PEN value posted by the provision journal (the source side of the period consolidation).
    invoicePenEquivalent: { type: Number, min: 0 },
    // Period the provision was posted in (the invoice/document date's period).
    accountingPeriod: { type: String, match: /^\d{4}-\d{2}$/, index: true },
    // false once the CXP is cancelled, so the same voucher identity can be registered again.
    voucherActive: { type: Boolean, default: true },
    sunatValidation: {
      status: String,
      manualException: {
        reason: String,
        evidenceReference: String,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approvedAt: Date
      }
    },
    adjustments: [{
      kind: { type: String, enum: ["CREDIT_NOTE", "DEBIT_NOTE"], required: true },
      sunatVoucher: { type: mongoose.Schema.Types.ObjectId, ref: "SunatVoucher" },
      voucherType: String,
      series: String,
      number: String,
      documentDate: Date,
      amount: { type: Number, min: 0 },
      appliedToPayable: { type: Number, min: 0, default: 0 },
      supplierCreditAmount: { type: Number, min: 0, default: 0 },
      supplierCredit: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCredit" },
      penEquivalent: { type: Number, min: 0 },
      journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
      period: String,
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    }],
    supplierCreditApplications: [{
      supplierCredit: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierCredit" },
      amount: { type: Number, min: 0 },
      journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    }],
    cancellation: {
      reason: String,
      period: String,
      penEquivalent: Number,
      journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
      at: Date,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
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
    // Only active (non-cancelled) payables hold the voucher identity. Existing databases must drop
    // the previous "accounts_payable_voucher_unique" index once (see docs/OPERATIONS.md).
    partialFilterExpression: {
      supplierIdentifierSnapshot: { $type: "string" },
      "voucher.voucherType": { $type: "string" },
      "voucher.series": { $type: "string" },
      "voucher.number": { $type: "string" },
      voucherActive: true
    },
    name: "accounts_payable_active_voucher_unique"
  }
);

export default mongoose.model("AccountsPayable", accountsPayableSchema);
