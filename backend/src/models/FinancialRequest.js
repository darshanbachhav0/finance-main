import { canonicalRequestStatus, LEGACY_WORKFLOW_STATUSES, statusAliases } from "../../../shared/workflowStatus.mjs";
import mongoose from "mongoose";
import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";
import { DEFAULT_REQUEST_PRIORITY, normalizeRequestPriority } from "../../../shared/requestPriority.mjs";
import { COST_CENTER_TYPE, COST_CENTER_TYPES, costAllocationProblems, splitByPercentages } from "../../../shared/costCenterAllocation.mjs";
import { paymentTermFields, validateAndNormalizePaymentTerms } from "./paymentTermFields.js";
import {
  ACKNOWLEDGMENT_TYPES,
  APPROVAL_ROUTING_MODE,
  APPROVAL_STAGES,
  APPROVAL_TIERS,
  CAPEX_ASSET_CATEGORIES,
  CANONICAL_REQUEST_STATUSES,
  BENEFICIARY_BANKS,
  CURRENCY,
  EXPENSE_NATURE,
  EXPENSE_NATURES,
  FLOW_TYPE,
  FLOW_TYPES,
  LEGACY_EXPENSE_NATURE_MAP,
  LEGACY_REQUEST_TYPE_MAP,
  LEGACY_STATUS_MAP,
  OPEX_EXPENSE_FREQUENCIES,
  PAYBACK_UNITS,
  RENDITION_LINE_TYPES,
  RENDITION_RECEIPT_TYPES,
  REQUEST_FREQUENCIES,
  LEGACY_REQUEST_PRIORITIES,
  REQUEST_PRIORITIES,
  REQUEST_PRIORITY_RANK,
  REQUEST_STATUS,
  REQUEST_TYPES,
  TREASURY_ACCOUNT_KINDS,
  TREASURY_TRANSFER_PURPOSES
} from "../utils/constants.js";
import { assertLineTotal, moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { nextRequestNumber } from "../services/sequenceService.js";

const lineSchema = new mongoose.Schema(
  {
    itemDescription: { type: String, trim: true, default: "" },
    quantity: { type: Number, min: 0 },
    unitOfMeasure: { type: String, trim: true, default: "" },
    unitPrice: { type: Number, min: 0 },
    // Undefined preserves historical manually entered amounts.
    priceIncludesIGV: { type: Boolean, default: undefined },
    commercialTotal: { type: Number, min: 0, default: 0 },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    // Accounting account (PCGE) of the line. Requesters never choose it: the platform suggests
    // one from the request type and expense nature, and Accounting confirms or replaces it when
    // processing the invoice. It plays no part in budget control.
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType" },
    accountSource: { type: String, enum: ["SUGGESTED", "ACCOUNTING"] },
    budgetItem: { type: String, trim: true, default: "" },
    projectId: { type: String, trim: true, default: "" },
    subAccount: { type: String, trim: true, default: "" },
    costCenterSnapshot: {
      code: String,
      name: String,
      area: String,
      organizationalUnit: String,
      organizationalUnitCode: String
    },
    expenseTypeSnapshot: {
      code: String,
      name: String,
      category: String,
      accountingClass: String,
      accountNumber: String,
      deductible: Boolean
    },
    currency: { type: String, enum: CURRENCY },
    exchangeRate: { type: Number, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    igvAmount: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    penEquivalent: { type: Number, default: 0, min: 0 }
  },
  { _id: true }
);

const quotationSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierSnapshot: {
      identifierType: String,
      identifier: String,
      legalName: String
    },
    amount: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCY, default: "PEN" },
    deliveryPeriod: { type: String, trim: true, default: "" },
    ...paymentTermFields,
    commercialConditions: { type: String, trim: true, default: "" },
    attachment: { type: mongoose.Schema.Types.ObjectId },
    recommended: { type: Boolean, default: false }
  },
  { _id: true }
);

quotationSchema.pre("validate", validateAndNormalizePaymentTerms);

const mobilityLineSchema = new mongoose.Schema(
  {
    date: Date,
    origin: { type: String, trim: true, default: "" },
    destination: { type: String, trim: true, default: "" },
    servicePurpose: { type: String, trim: true, default: "" },
    amount: { type: Number, min: 0, default: 0 },
    limitExceeded: { type: Boolean, default: false }
  },
  { _id: true }
);

const unsupportedExpenseLineSchema = new mongoose.Schema(
  {
    date: Date,
    description: { type: String, trim: true, default: "" },
    goodsServiceType: { type: String, enum: RENDITION_LINE_TYPES },
    grossAmount: { type: Number, min: 0, default: 0 }
  },
  { _id: true }
);

// A receipt presented in an advance's rendition (factura, boleta, ticket...), with its file.
const receiptLineSchema = new mongoose.Schema(
  {
    date: Date,
    documentType: { type: String, enum: RENDITION_RECEIPT_TYPES, default: "BOLETA" },
    documentNumber: { type: String, trim: true, default: "" },
    issuerRuc: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    amount: { type: Number, min: 0, default: 0 },
    attachment: { type: mongoose.Schema.Types.ObjectId }
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        "XML",
        "PDF",
        "QUOTATION",
        "PURCHASE_ORDER",
        "CONTRACT",
        "CONFORMITY",
        "FEE_RECEIPT",
        "ACTIVITY_REPORT",
        "SUPPORTING",
        "RENDITION",
        "RETURN_RECEIPT",
        "CCI_LETTER"
      ],
      required: true
    },
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

const workflowHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    statusFrom: String,
    statusTo: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    role: String,
    comments: String,
    ip: String,
    signature: String,
    signatureType: { type: String, default: "AUTHENTICATED_ELECTRONIC_SIGN_OFF" },
    snapshotHash: String,
    stage: String,
    startedAt: Date,
    dueAt: Date,
    completedAt: Date,
    slaResult: { type: String, enum: ["ON_TIME", "OVERDUE", "NOT_APPLICABLE"] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const xmlValidationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["NOT_REQUIRED", "PENDING", "VALID", "INVALID", "MANUAL"], default: "PENDING" },
    validated: { type: Boolean, default: false },
    validatedAt: Date,
    provider: { type: String, default: "LOCAL_XML" },
    // Which file evidenced the invoice: its XML, or the factura PDF when no XML was uploaded.
    source: { type: String, enum: ["XML", "PDF"] },
    supplierMatch: Boolean,
    currencyMatch: Boolean,
    documentNumberMatch: Boolean,
    dateMatch: Boolean,
    netMatch: Boolean,
    igvMatch: Boolean,
    totalMatch: Boolean,
    errors: [String],
    errorMessages: [String],
    // Each difference with the invoice file: field, the value expected and the value found (null when
    // the file does not show it). services/xmlValidationService.js
    mismatches: [{ _id: false, field: String, expected: mongoose.Schema.Types.Mixed, found: mongoose.Schema.Types.Mixed }],
    rawMetadataReference: String,
    data: {
      ruc: String,
      supplierName: String,
      invoiceNumber: String,
      documentTypeCode: String,
      voucherType: String,
      issueDate: String,
      currency: String,
      netAmount: Number,
      igvAmount: Number,
      totalAmount: Number
    }
  },
  { _id: false, suppressReservedKeysWarning: true }
);

// A beneficiary CECO of a Por Encargo request: its share of the expense, in percent and in money
// (request currency and PEN), kept in step with the request total.
const costAllocationSchema = new mongoose.Schema(
  {
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter", required: true },
    costCenterSnapshot: {
      code: String,
      name: String,
      area: String,
      organizationalUnit: String,
      organizationalUnitCode: String
    },
    percentage: { type: Number, required: true, min: 0.01, max: 100 },
    amount: { type: Number, default: 0, min: 0 },
    penEquivalent: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const approvalRouteSnapshotSchema = new mongoose.Schema(
  {
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalRule" },
    approvalLevel: String,
    role: String,
    sequence: Number,
    slaHours: Number,
    required: Boolean,
    status: { type: String, enum: ["PENDING", "NOT_REACHED", "APPROVED", "OBSERVED", "RETURNED", "REJECTED", "SKIPPED"], default: "PENDING" },
    startedAt: Date,
    dueAt: Date,
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approverUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approverSnapshot: {
      name: String,
      dni: { type: String, select: false },
      jobTitle: String
    },
    // A substitute approving on behalf of an absent manager: the manager whose step this is.
    coveringFor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    coveringForSnapshot: {
      name: String,
      jobTitle: String
    },
    source: { type: String, enum: Object.values(APPROVAL_ROUTING_MODE), default: APPROVAL_ROUTING_MODE.RULE_BASED },
    // A policy step decided by role (APPROVAL_TIERS): the UIT amount tiers and Track D's pair.
    tier: { type: String, enum: Object.keys(APPROVAL_TIERS) },
    // First manager-chain level only: its approval must go up to the approver's superior.
    superiorRequired: Boolean,
    // A cost-center step, fixed when the request is sent (services/approvalRuleService.js): the
    // CECO's responsible, a Por Encargo beneficiary's "visto" or the superior in the cascade. Its
    // approver only approves: the step is never forwarded or finalized for the steps after it.
    fixed: Boolean,
    costCenterRole: { type: String, enum: ["RESPONSIBLE", "BENEFICIARY", "SUPERIOR"] },
    costCenterCode: String
  },
  { _id: true }
);

// Track D: one of UMA's own bank accounts, as it was when the transfer was registered.
const treasuryAccountSnapshotSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: "TreasuryBankAccount" },
    code: String,
    bank: String,
    currency: { type: String, enum: CURRENCY },
    accountNumber: String,
    cci: String,
    ledgerAccount: String,
    kind: { type: String, enum: TREASURY_ACCOUNT_KINDS }
  },
  { _id: false }
);

// The receiver signs on issue; responsible CECO manager and (above 5 UIT) Vice-Rector sign next.
// Signatures are authenticated application attestations with immutable document hash and audit;
// they are NOT certificate-based or legally qualified digital signatures.
const digitalActaSchema = new mongoose.Schema({
  status: { type: String, enum: ["PENDING", "COMPLETE", "OBSERVED"], required: true },
  conformity: { type: String, enum: ["TOTAL", "PARTIAL", "NON_CONFORMING"], required: true },
  description: { type: String, required: true, trim: true },
  milestone: { type: String, trim: true, default: "" },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  responsible: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  viceRector: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  issuedAt: { type: Date, required: true },
  documentHash: { type: String, required: true },
  signatures: [{
    signer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    as: { type: String, enum: ["RECEIVER", "RESPONSIBLE", "VICE_RECTOR"], required: true },
    signature: { type: String, required: true },
    signedAt: { type: Date, required: true },
    documentHash: { type: String, required: true }
  }],
  completedAt: Date
}, { _id: true });

const financialRequestSchema = new mongoose.Schema(
  {
    workflowVersion: { type: Number, default: 2 },
    legacyWorkflowStatus: String,
    developmentScenarioKey: { type: String, sparse: true, unique: true, immutable: true },
    requestNumber: { type: String, required: true, unique: true, immutable: true, match: /^(SOL|REQ)-\d{4}-\d{5,7}$/ },
    areaCorrelative: { type: String, trim: true, index: true },
    issueDate: { type: Date, required: true },
    accountingPeriod: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    solicitor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requesterArea: { type: String, trim: true },
    requestingArea: { type: String, trim: true },
    requesterCostCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    requesterCostCenterSnapshot: {
      code: String,
      name: String,
      area: String,
      organizationalUnit: String,
      organizationalUnitCode: String
    },
    authorizedCostCenterOverride: {
      authorized: { type: Boolean, default: false },
      authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: String
    },
    // Tipo de Centro de Costo (shared/costCenterAllocation.mjs). PROPIO is every request saved before
    // this field. POR_ENCARGO: requesterArea / requesterCostCenter stay the requesting department, and
    // costAllocations name the beneficiary CECO(s) that bear the expense; the lines carry the first one.
    costCenterType: { type: String, enum: COST_CENTER_TYPES, default: COST_CENTER_TYPE.OWN },
    costAllocations: { type: [costAllocationSchema], default: undefined },
    // The beneficiary CECOs' heads, resolved when a Por Encargo request is sent: they are told about
    // it and may open and comment on it. They review it; they are not an approval step.
    costCenterReviewers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: undefined },
    schoolOrDepartment: { type: String, trim: true },
    flowType: { type: String, enum: FLOW_TYPES, default: FLOW_TYPE.A1, index: true },
    requestType: { type: String, enum: REQUEST_TYPES, required: true, set: (value) => LEGACY_REQUEST_TYPE_MAP[value] || value },
    expenseNature: { type: String, enum: EXPENSE_NATURES, default: EXPENSE_NATURE.SERVICES, set: (value) => LEGACY_EXPENSE_NATURE_MAP[value] || value },
    // Payment priority P1-P4 (shared/requestPriority.mjs). Older requests stored Alta / Media / Baja:
    // they are read as P2 / P3 / P3.
    priority: { type: String, enum: [...REQUEST_PRIORITIES, ...LEGACY_REQUEST_PRIORITIES], default: DEFAULT_REQUEST_PRIORITY, set: normalizeRequestPriority },
    // Kept with priority so lists sort P1 > P2 > P3 > P4.
    priorityRank: { type: Number, min: 1, max: 4, default: REQUEST_PRIORITY_RANK[DEFAULT_REQUEST_PRIORITY] },
    // Why it cannot wait for the fortnightly payment (required for P1 and P2).
    urgencyJustification: { type: String, trim: true, default: "" },
    // Fecha de vencimiento: when the supplier must be paid. P4 is paid on the last fortnightly
    // payment day before it; P3 too when it comes before the next one.
    dueDate: Date,
    // The requester's job category (Portal de Personas) when the request was sent: only some
    // categories may charge other cost centers (ENCARGO_JOB_CATEGORIES).
    requesterJobCategory: { type: Number, min: 1, max: 8 },
    // How often the need recurs. Recorded only: no request or payment is ever repeated from it.
    frequency: { type: String, enum: REQUEST_FREQUENCIES, default: "ONE_OFF" },
    observations: { type: String, trim: true, default: "" },
    // The supplier account the requester says the supplier is paid into, and its currency. Only the
    // bank, type, currency and last digits are copied; the number stays in SupplierBankAccount.
    // Treasury pays it when Accounting has verified it (services/paymentDestinationService.js).
    paymentAccount: {
      account: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierBankAccount" },
      bank: { type: String, enum: BENEFICIARY_BANKS },
      bankOtherName: { type: String, trim: true },
      currency: { type: String, enum: CURRENCY },
      accountType: { type: String, enum: ["CURRENT", "SAVINGS"] },
      accountLast4: { type: String, trim: true }
    },
    // The supplier's comprobante as read (XML / PDF) or typed on the request and checked by the
    // requester. PENDING: not issued yet when the request was made. It is not the registered
    // invoice: Accounting still validates the voucher itself (SunatVoucher) before any payment.
    invoiceDetails: {
      status: { type: String, enum: ["PENDING", "ATTACHED"] },
      source: { type: String, enum: ["XML", "PDF", "MANUAL"] },
      documentType: { type: String, trim: true },
      number: { type: String, trim: true },
      issueDate: Date,
      ruc: { type: String, trim: true },
      supplierName: { type: String, trim: true },
      currency: { type: String, enum: CURRENCY },
      totalAmount: { type: Number, min: 0 },
      igvAmount: { type: Number, min: 0 }
    },
    project: { type: String, trim: true },
    title: { type: String, trim: true, default: "" },
    detailedDescription: { type: String, trim: true, default: "" },
    businessJustification: { type: String, trim: true, default: "" },
    nonApprovalRisk: { type: String, trim: true, default: "" },
    capexDetails: {
      // Caso de negocio approved (Viable or Ejecutar) in the business-case app: CN-AAAA-NNN.
      businessCaseCode: { type: String, trim: true, uppercase: true, default: "" },
      projectPep: { type: String, trim: true, default: "" },
      projectSnapshot: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
        code: String,
        name: String
      },
      assetCategory: { type: String, enum: CAPEX_ASSET_CATEGORIES },
      usefulLifeYears: { type: Number, min: 0 },
      npv: {
        amount: { type: Number },
        currency: { type: String, enum: CURRENCY }
      },
      payback: {
        value: { type: Number, min: 0 },
        unit: { type: String, enum: PAYBACK_UNITS }
      }
    },
    opexDetails: {
      expenseFrequency: { type: String, enum: OPEX_EXPENSE_FREQUENCIES }
    },
    currency: { type: String, enum: CURRENCY, required: true },
    sourceCurrencyAmount: { type: Number, default: 0, min: 0 },
    exchangeRate: { type: Number, default: 1, min: 0 },
    exchangeRateDate: Date,
    exchangeRateSource: String,
    exchangeRateEvidence: mongoose.Schema.Types.Mixed,
    fiscalValidation: mongoose.Schema.Types.Mixed,
    totalNet: { type: Number, default: 0, min: 0 },
    totalIGV: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    totalPENEquivalent: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, default: 0, min: 0 },
    igvAmount: { type: Number, default: 0, min: 0 },
    penEquivalent: { type: Number, default: 0, min: 0 },
    totalCommercialAmount: { type: Number, default: 0, min: 0 },
    commercialTotalDifference: { type: Number, default: 0 },
    commercialTotalStatus: { type: String, enum: ["NOT_APPLICABLE", "INCOMPLETE", "MATCH", "MISMATCH"], default: "NOT_APPLICABLE" },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required() { return ![FLOW_TYPE.C, FLOW_TYPE.D].includes(this.flowType); }
    },
    // Track D (traspaso): money moves between two of UMA's own accounts in the same currency.
    // Approved by a Treasury user other than the requester and the GAF; Treasury then executes it
    // (operation number, journal debit destination / credit source) and reconciles it.
    treasuryTransfer: {
      purpose: { type: String, enum: TREASURY_TRANSFER_PURPOSES },
      sourceAccount: { type: treasuryAccountSnapshotSchema, default: undefined },
      destinationAccount: { type: treasuryAccountSnapshotSchema, default: undefined },
      // Placement (INVESTMENT): the instrument and its reference, e.g. "DPF 60 días" / certificate.
      instrument: { type: String, trim: true },
      reference: { type: String, trim: true },
      executedAt: Date,
      executedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      operationNumber: { type: String, trim: true },
      journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" }
    },
    supplierSnapshot: {
      identifierType: String,
      identifier: String,
      legalName: String,
      homologationStatus: String
    },
    status: { type: String, enum: CANONICAL_REQUEST_STATUSES, default: REQUEST_STATUS.DRAFT, index: true, set: function (value) { return this instanceof mongoose.Query ? value : (LEGACY_STATUS_MAP[value] || value); } },
    description: { type: String, required: true, trim: true },
    quotations: { type: [quotationSchema], default: [] },
    supplierSelectionReason: { type: String, trim: true, default: "" },
    // Planned supplier terms only. Confirmed employee advances remain in Track C.
    supplierPaymentTerms: { type: new mongoose.Schema(paymentTermFields, { _id: false }).pre("validate", validateAndNormalizePaymentTerms), default: undefined },
    supplierCreditDaysSnapshot: { type: Number, min: 0 },
    quotationException: {
      authorized: { type: Boolean, default: false },
      authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      authorizedAt: Date,
      reason: { type: String, trim: true, default: "" },
      ruleCode: { type: String, trim: true, default: "" }
    },
    lines: {
      type: [lineSchema],
      validate: { validator: (lines) => Array.isArray(lines) && lines.length > 0, message: "At least one request line is required." }
    },
    attachments: [attachmentSchema],
    digitalActa: { type: digitalActaSchema, default: undefined },
    xmlValidation: { type: xmlValidationSchema, default: () => ({}) },
    xmlValidationHistory: { type: [xmlValidationSchema], default: [] },
    approvalHistory: [workflowHistorySchema],
    approvalRouteSnapshot: [approvalRouteSnapshotSchema],
    approvalRoutingMode: { type: String, enum: Object.values(APPROVAL_ROUTING_MODE), default: APPROVAL_ROUTING_MODE.RULE_BASED },
    approvalStage: { type: String, default: APPROVAL_STAGES.AREA_DIRECTOR },
    approvalDueAt: Date,
    rejectionReason: String,
    draftSavedAt: Date,
    budgetCommitment: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetCommitment" },
    accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
    accountsPayables: [{ type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" }],
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseOrder" },
    massUploadBatches: [{ type: mongoose.Schema.Types.ObjectId, ref: "MassUploadBatch" }],
    paymentBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
    reconciliation: { type: mongoose.Schema.Types.ObjectId, ref: "Reconciliation" },
    observation: {
      code: { type: String, trim: true },
      detail: { type: String, trim: true },
      // Who can clear it: REQUESTER (correct the request and resubmit), ACCOUNTING (approve a manual
      // SUNAT exception) or BUDGET (decide the budget exception). With ACCOUNTING or BUDGET the
      // request continues without new approvals.
      resolver: { type: String, enum: ["REQUESTER", "ACCOUNTING", "BUDGET"] },
      observedAt: Date,
      observedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      resolvedAt: Date,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    directPayment: {
      express: { type: Boolean, default: false },
      xmlLocked: { type: Boolean, default: false },
      immutableAmounts: {
        netAmount: Number,
        igvAmount: Number,
        totalAmount: Number,
        currency: String
      },
      provisionedAt: Date,
      provisionedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    fiscalData: {
      supplierIdentifierNormalized: { type: String, trim: true, uppercase: true },
      voucherType: { type: String, trim: true, uppercase: true },
      documentType: { type: String, trim: true, uppercase: true },
      series: { type: String, trim: true, uppercase: true },
      number: { type: String, trim: true, uppercase: true },
      documentDate: Date,
      accountingDate: Date,
      fiscalPeriod: { type: String, match: /^\d{4}-\d{2}$/ },
      accountNumber: { type: String, trim: true },
      subaccountNumber: { type: String, trim: true },
      igvDeductible: { type: Boolean, default: undefined },
      spotConfirmed: Boolean,
      spotCategoryCode: { type: String, trim: true },
      comments: String,
      processedAt: Date,
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    bankFile: {
      bank: String,
      fileName: String,
      url: String,
      generatedAt: Date,
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
    },
    payment: {
      operationNumber: String,
      paidAt: Date,
      confirmedAmount: Number,
      comments: String,
      confirmedAt: Date,
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      confirmations: [{
        accountsPayable: { type: mongoose.Schema.Types.ObjectId, ref: "AccountsPayable" },
        paymentBatch: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentBatch" },
        operationNumber: { type: String, trim: true },
        paidAt: Date,
        amount: { type: Number, min: 0 },
        currency: { type: String, enum: CURRENCY },
        confirmedAt: Date,
        confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        comments: String
      }],
      reconciliationComments: String
    },
    rendition: {
      number: { type: String, match: /^RG-\d{4}-\d{5,7}$/ },
      beneficiarySnapshot: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        employeeCode: { type: String, trim: true, uppercase: true },
        name: { type: String, trim: true },
        email: { type: String, trim: true, lowercase: true },
        area: { type: String, trim: true },
        costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
        costCenterCode: String,
        costCenterName: String
      },
      receiptLines: { type: [receiptLineSchema], default: [] },
      mobilityLines: { type: [mobilityLineSchema], default: [] },
      unsupportedExpenseLines: { type: [unsupportedExpenseLineSchema], default: [] },
      receiptSubtotal: { type: Number, default: 0, min: 0 },
      mobilitySubtotal: { type: Number, default: 0, min: 0 },
      // The deposit slip for the unspent money the employee returned.
      returnDepositSlip: { type: mongoose.Schema.Types.ObjectId },
      unsupportedExpenseSubtotal: { type: Number, default: 0, min: 0 },
      reimbursementTotal: { type: Number, default: 0, min: 0 },
      detailReconciliation: {
        accountingRenderedAmount: { type: Number, default: 0 },
        difference: { type: Number, default: 0 },
        status: { type: String, enum: ["NOT_APPLICABLE", "MATCH", "MISMATCH"], default: "NOT_APPLICABLE" }
      },
      unsupportedExpenseDeclaration: {
        confirmedExceptionalUse: { type: Boolean, default: false },
        comments: { type: String, trim: true, default: "" },
        declaredAt: Date
      },
      financeReview: {
        result: { type: String, enum: ["PENDING", "APPROVED", "OBSERVED", "REJECTED"], default: "PENDING" },
        reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: Date,
        comments: { type: String, trim: true, default: "" }
      },
      beneficiaryAcknowledgment: {
        type: { type: String, enum: ACKNOWLEDGMENT_TYPES },
        signer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        signerName: { type: String, trim: true },
        signedAt: Date,
        ip: { type: String, trim: true },
        reference: { type: String, trim: true },
        attachment: { type: mongoose.Schema.Types.ObjectId }
      },
      reimbursementBankSnapshot: {
        profile: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeReimbursementBankAccount" },
        bank: String,
        currency: { type: String, enum: CURRENCY },
        accountHolderName: { type: String, select: false },
        accountNumber: { type: String, select: false },
        cci: { type: String, select: false },
        verificationStatus: String,
        capturedAt: Date
      },
      limitEvaluation: {
        configuration: { type: mongoose.Schema.Types.ObjectId, ref: "FinanceConfiguration" },
        key: { type: String, trim: true },
        configuredValue: Number,
        currency: { type: String, enum: CURRENCY },
        effectiveFrom: Date,
        effectiveTo: Date,
        behavior: { type: String, enum: ["INFORMATION", "WARNING", "FLAG", "BLOCK"] },
        evaluatedAt: Date,
        exceededLineCount: { type: Number, default: 0, min: 0 }
      },
      amountAdvanced: { type: Number, default: 0, min: 0 },
      amountRendered: { type: Number, default: 0, min: 0 },
      amountReturned: { type: Number, default: 0, min: 0 },
      balanceOutstanding: { type: Number, default: 0, min: 0 },
      dueAt: Date,
      overdueBlockedAt: Date,
      nonDeductibleOutstanding: { type: Number, default: 0, min: 0 },
      nonDeductibleSettlements: [{
        method: { type: String, enum: ["REIMBURSEMENT", "PAYROLL_DEDUCTION"] },
        amount: { type: Number, min: 0 },
        reference: { type: String, trim: true },
        settledAt: Date,
        settledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" }
      }],
      status: { type: String, enum: ["NOT_REQUIRED", "PENDING", "SUBMITTED", "OBSERVED", "VALIDATED", "REJECTED"], default: "NOT_REQUIRED" },
      recovery: {
        status: { type: String, enum: ["NOT_APPLICABLE", "PENDING", "RECOVERED"], default: "NOT_APPLICABLE" },
        advanceAmount: { type: Number, default: 0, min: 0 },
        returnedAmount: { type: Number, default: 0, min: 0 },
        returnJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" },
        outstandingAmount: { type: Number, default: 0, min: 0 },
        settlements: [{
          method: { type: String, enum: ["REIMBURSEMENT", "PAYROLL_DEDUCTION"] },
          amount: { type: Number, min: 0 },
          reference: { type: String, trim: true },
          operationNumber: { type: String, trim: true },
          operationDate: Date,
          settledAt: Date,
          settledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          journal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry" }
        }]
      },
      lines: { type: [lineSchema], default: [] },
      documentIds: [{ type: mongoose.Schema.Types.ObjectId }],
      submittedAt: Date,
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      validatedAt: Date,
      validator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      comments: String
    },
    migrationReview: {
      required: { type: Boolean, default: false },
      reasons: [String],
      migratedFromStatus: String,
      migratedAt: Date
    }
  },
  { timestamps: true, optimisticConcurrency: true }
);

financialRequestSchema.pre("validate", async function beforeValidate() {
  // The number is taken when the request is saved: a check that only validates (and may still
  // refuse the request) leaves the sequence untouched, so saved requests are numbered in order.
  if (!this.requestNumber && !this.$locals.deferRequestNumber) this.requestNumber = await nextRequestNumber(this.issueDate || new Date());
  this.priority = normalizeRequestPriority(this.priority) || DEFAULT_REQUEST_PRIORITY;
  this.priorityRank = REQUEST_PRIORITY_RANK[this.priority] || REQUEST_PRIORITY_RANK[DEFAULT_REQUEST_PRIORITY];
  // Requests from before the frequency field kept it in opexDetails; OPEX keeps both in step.
  if (this.$isDefault("frequency") && this.opexDetails?.expenseFrequency) this.frequency = this.opexDetails.expenseFrequency;
  if (this.requestType === "OPEX" && this.frequency) {
    this.opexDetails ||= {};
    this.opexDetails.expenseFrequency = this.frequency;
  }
  if (this.requestType === "ENTREGA_RENDIR") this.flowType = FLOW_TYPE.C;
  if (this.requestType === "TRASPASO") this.flowType = FLOW_TYPE.D;
  if (!this.requester) this.requester = this.solicitor;
  if (!this.solicitor) this.solicitor = this.requester;
  if (!this.requesterArea) this.requesterArea = this.requestingArea;
  if (!this.requestingArea) this.requestingArea = this.requesterArea;

  let commercialLineCount = 0;
  let incompleteCommercialLine = false;
  // An advance or a reimbursement (Track C) is not an invoice, nor is a transfer between UMA's own
  // accounts (Track D): their lines carry no IGV, so the amount is what is paid.
  const igvExempt = [FLOW_TYPE.C, FLOW_TYPE.D].includes(this.flowType);
  for (const [index, line] of (this.lines || []).entries()) {
    const automaticIGV = typeof line.priceIncludesIGV === "boolean";
    if (automaticIGV) {
      const calculated = calculateRequestLineAmounts({ quantity: line.quantity, unitPrice: line.unitPrice, priceIncludesIGV: line.priceIncludesIGV, igvExempt });
      line.unitPrice = calculated.unitPrice;
      line.netAmount = calculated.netAmount;
      line.igvAmount = calculated.igvAmount;
      line.totalAmount = calculated.totalAmount;
    } else if (igvExempt) {
      line.netAmount = line.totalAmount;
      line.igvAmount = 0;
    }
    line.netAmount = roundMoney(line.netAmount);
    line.igvAmount = roundMoney(line.igvAmount);
    line.totalAmount = roundMoney(line.totalAmount);
    assertLineTotal(line, index);
    line.currency ||= this.currency;
    line.exchangeRate ||= this.exchangeRate || 1;
    line.penEquivalent = automaticIGV ? multiplyMoney(line.totalAmount, line.exchangeRate) : roundMoney(line.penEquivalent || multiplyMoney(line.totalAmount, line.exchangeRate));

    const hasQuantity = line.quantity !== null && line.quantity !== undefined;
    const hasUnitPrice = line.unitPrice !== null && line.unitPrice !== undefined;
    if (hasQuantity && hasUnitPrice) {
      line.unitPrice = roundMoney(line.unitPrice);
      line.commercialTotal = automaticIGV ? line.totalAmount : multiplyMoney(line.unitPrice, line.quantity);
      commercialLineCount += 1;
    } else {
      line.commercialTotal = 0;
      if (hasQuantity || hasUnitPrice || line.itemDescription || line.unitOfMeasure) incompleteCommercialLine = true;
    }
  }

  this.totalNet = sumMoney((this.lines || []).map((line) => line.netAmount));
  this.totalIGV = sumMoney((this.lines || []).map((line) => line.igvAmount));
  this.totalAmount = sumMoney((this.lines || []).map((line) => line.totalAmount));
  this.totalPENEquivalent = sumMoney((this.lines || []).map((line) => line.penEquivalent));
  this.sourceCurrencyAmount = this.totalAmount;
  this.netAmount = this.totalNet;
  this.igvAmount = this.totalIGV;
  this.penEquivalent = this.totalPENEquivalent;

  // A Por Encargo request's shares follow its total; a Propio request carries none.
  if (this.costCenterType === COST_CENTER_TYPE.ON_BEHALF) {
    const allocations = this.costAllocations || [];
    const problem = costAllocationProblems(allocations)[0];
    if (problem) this.invalidate("costAllocations", problem.message);
    else {
      const percentages = allocations.map((allocation) => allocation.percentage);
      const amounts = splitByPercentages(this.totalAmount, percentages);
      const penAmounts = splitByPercentages(this.totalPENEquivalent, percentages);
      allocations.forEach((allocation, index) => {
        allocation.amount = amounts[index];
        allocation.penEquivalent = penAmounts[index];
      });
    }
  } else if (this.costAllocations?.length) this.costAllocations = undefined;

  this.totalCommercialAmount = sumMoney((this.lines || []).map((line) => line.commercialTotal));
  this.commercialTotalDifference = subtractMoney(this.totalCommercialAmount, this.totalAmount);
  if (!commercialLineCount && !incompleteCommercialLine) this.commercialTotalStatus = "NOT_APPLICABLE";
  else if (incompleteCommercialLine || commercialLineCount !== (this.lines || []).length) this.commercialTotalStatus = "INCOMPLETE";
  else this.commercialTotalStatus = moneyEquals(this.totalCommercialAmount, this.totalAmount) ? "MATCH" : "MISMATCH";

  const receiptLines = this.rendition?.receiptLines || [];
  const mobilityLines = this.rendition?.mobilityLines || [];
  const unsupportedLines = this.rendition?.unsupportedExpenseLines || [];
  for (const line of receiptLines) line.amount = roundMoney(line.amount);
  for (const line of mobilityLines) line.amount = roundMoney(line.amount);
  for (const line of unsupportedLines) line.grossAmount = roundMoney(line.grossAmount);
  if (this.rendition) {
    this.rendition.receiptSubtotal = sumMoney(receiptLines.map((line) => line.amount));
    this.rendition.mobilitySubtotal = sumMoney(mobilityLines.map((line) => line.amount));
    this.rendition.unsupportedExpenseSubtotal = sumMoney(unsupportedLines.map((line) => line.grossAmount));
    this.rendition.reimbursementTotal = sumMoney([
      this.rendition.receiptSubtotal,
      this.rendition.mobilitySubtotal,
      this.rendition.unsupportedExpenseSubtotal
    ]);
    const hasOfficialDetails = receiptLines.length > 0 || mobilityLines.length > 0 || unsupportedLines.length > 0;
    this.rendition.detailReconciliation.accountingRenderedAmount = roundMoney(this.rendition.amountRendered);
    this.rendition.detailReconciliation.difference = subtractMoney(
      this.rendition.reimbursementTotal,
      this.rendition.amountRendered
    );
    this.rendition.detailReconciliation.status = hasOfficialDetails
      ? (moneyEquals(this.rendition.reimbursementTotal, this.rendition.amountRendered) ? "MATCH" : "MISMATCH")
      : "NOT_APPLICABLE";
  }
});

financialRequestSchema.pre("save", async function protectAssignedRenditionNumber() {
  if (this.isNew || !this.isModified("rendition.number")) return;
  const stored = await this.constructor.findById(this._id).select("rendition.number").lean();
  if (stored?.rendition?.number && stored.rendition.number !== this.rendition?.number) {
    throw new Error("Rendition number is immutable after assignment.");
  }
});

financialRequestSchema.index({ accountingPeriod: 1, status: 1, createdAt: -1 });
financialRequestSchema.index({ flowType: 1, status: 1, createdAt: -1 });
financialRequestSchema.index({ priorityRank: -1, createdAt: -1 });
financialRequestSchema.index({ requester: 1, createdAt: -1 });
financialRequestSchema.index({ solicitor: 1, createdAt: -1 });
financialRequestSchema.index({ supplier: 1, createdAt: -1 });
financialRequestSchema.index(
  { "rendition.number": 1 },
  {
    unique: true,
    partialFilterExpression: { "rendition.number": { $type: "string" } },
    name: "rendition_number_unique"
  }
);
financialRequestSchema.index({ approvalStage: 1, status: 1, approvalDueAt: 1 });
financialRequestSchema.index(
  {
    "fiscalData.supplierIdentifierNormalized": 1,
    "fiscalData.voucherType": 1,
    "fiscalData.series": 1,
    "fiscalData.number": 1
  },
  {
    unique: true,
    partialFilterExpression: {
      "fiscalData.supplierIdentifierNormalized": { $type: "string" },
      "fiscalData.voucherType": { $type: "string" },
      "fiscalData.series": { $type: "string" },
      "fiscalData.number": { $type: "string" }
    },
    name: "voucher_identity_unique"
  }
);


for (const option of ["toJSON", "toObject"]) financialRequestSchema.set(option, {
  transform(_doc, value) { value.status = canonicalRequestStatus(value.status); return value; }
});
function expandStatuses(query) {
  if (!query || typeof query !== "object") return;
  for (const key of ["$and", "$or", "$nor"]) query[key]?.forEach(expandStatuses);
  const value = query.status;
  if (typeof value === "string" && value !== "RENDICION_PENDIENTE") query.status = { $in: statusAliases(canonicalRequestStatus(value)) };
  else if (value && typeof value === "object") {
    for (const op of ["$in", "$nin"]) if (Array.isArray(value[op])) value[op] = [...new Set(value[op].flatMap(v => statusAliases(canonicalRequestStatus(v))))];
    if (value.$ne) { value.$nin = [...new Set([...(value.$nin || []), ...statusAliases(canonicalRequestStatus(value.$ne))])]; delete value.$ne; }
  }
}
for (const operation of ["find", "findOne", "countDocuments", "distinct"]) financialRequestSchema.pre(operation, function () { expandStatuses(this.getQuery()); });
financialRequestSchema.pre("aggregate", function () {
  this.pipeline().unshift({ $set: { status: { $switch: {
    branches: Object.entries(LEGACY_WORKFLOW_STATUSES).map(([legacy, canonical]) => ({ case: { $eq: ["$status", legacy] }, then: canonical })),
    default: "$status"
  } } } });
});
export default mongoose.model("FinancialRequest", financialRequestSchema);
