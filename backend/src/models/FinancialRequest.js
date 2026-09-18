import { canonicalRequestStatus, LEGACY_WORKFLOW_STATUSES, statusAliases } from "../../../shared/workflowStatus.mjs";
import mongoose from "mongoose";
import { calculateRequestLineAmounts } from "../../../shared/requestLineAmounts.mjs";
import { paymentTermFields, validateAndNormalizePaymentTerms } from "./paymentTermFields.js";
import {
  ACKNOWLEDGMENT_TYPES,
  APPROVAL_STAGES,
  CAPEX_ASSET_CATEGORIES,
  CANONICAL_REQUEST_STATUSES,
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
  REQUEST_PRIORITIES,
  REQUEST_STATUS,
  REQUEST_TYPES
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
    expenseType: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseType", required: true },
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
    supplierMatch: Boolean,
    currencyMatch: Boolean,
    documentNumberMatch: Boolean,
    dateMatch: Boolean,
    netMatch: Boolean,
    igvMatch: Boolean,
    totalMatch: Boolean,
    errors: [String],
    errorMessages: [String],
    rawMetadataReference: String,
    data: {
      ruc: String,
      supplierName: String,
      invoiceNumber: String,
      issueDate: String,
      currency: String,
      netAmount: Number,
      igvAmount: Number,
      totalAmount: Number
    }
  },
  { _id: false, suppressReservedKeysWarning: true }
);

const approvalRouteSnapshotSchema = new mongoose.Schema(
  {
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalRule" },
    approvalLevel: String,
    role: String,
    sequence: Number,
    slaHours: Number,
    required: Boolean,
    status: { type: String, enum: ["PENDING", "APPROVED", "OBSERVED", "RETURNED", "REJECTED", "SKIPPED"], default: "PENDING" },
    startedAt: Date,
    dueAt: Date,
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { _id: true }
);

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
    schoolOrDepartment: { type: String, trim: true },
    flowType: { type: String, enum: FLOW_TYPES, default: FLOW_TYPE.A1, index: true },
    requestType: { type: String, enum: REQUEST_TYPES, required: true, set: (value) => LEGACY_REQUEST_TYPE_MAP[value] || value },
    expenseNature: { type: String, enum: EXPENSE_NATURES, default: EXPENSE_NATURE.SERVICES, set: (value) => LEGACY_EXPENSE_NATURE_MAP[value] || value },
    priority: { type: String, enum: REQUEST_PRIORITIES, default: "MEDIA" },
    project: { type: String, trim: true },
    title: { type: String, trim: true, default: "" },
    detailedDescription: { type: String, trim: true, default: "" },
    businessJustification: { type: String, trim: true, default: "" },
    nonApprovalRisk: { type: String, trim: true, default: "" },
    capexDetails: {
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
      required() { return this.flowType !== FLOW_TYPE.C; }
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
    xmlValidation: { type: xmlValidationSchema, default: () => ({}) },
    xmlValidationHistory: { type: [xmlValidationSchema], default: [] },
    approvalHistory: [workflowHistorySchema],
    approvalRouteSnapshot: [approvalRouteSnapshotSchema],
    approvalStage: { type: String, enum: Object.values(APPROVAL_STAGES), default: APPROVAL_STAGES.AREA_DIRECTOR },
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
      mobilityLines: { type: [mobilityLineSchema], default: [] },
      unsupportedExpenseLines: { type: [unsupportedExpenseLineSchema], default: [] },
      mobilitySubtotal: { type: Number, default: 0, min: 0 },
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
      status: { type: String, enum: ["NOT_REQUIRED", "PENDING", "SUBMITTED", "OBSERVED", "VALIDATED"], default: "NOT_REQUIRED" },
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
  if (!this.requestNumber) this.requestNumber = await nextRequestNumber(this.issueDate || new Date());
  if (this.requestType === "ENTREGA_RENDIR") this.flowType = FLOW_TYPE.C;
  if (!this.requester) this.requester = this.solicitor;
  if (!this.solicitor) this.solicitor = this.requester;
  if (!this.requesterArea) this.requesterArea = this.requestingArea;
  if (!this.requestingArea) this.requestingArea = this.requesterArea;

  let commercialLineCount = 0;
  let incompleteCommercialLine = false;
  for (const [index, line] of (this.lines || []).entries()) {
    const automaticIGV = typeof line.priceIncludesIGV === "boolean";
    if (automaticIGV) {
      const calculated = calculateRequestLineAmounts(line);
      line.unitPrice = calculated.unitPrice;
      line.netAmount = calculated.netAmount;
      line.igvAmount = calculated.igvAmount;
      line.totalAmount = calculated.totalAmount;
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

  this.totalCommercialAmount = sumMoney((this.lines || []).map((line) => line.commercialTotal));
  this.commercialTotalDifference = subtractMoney(this.totalCommercialAmount, this.totalAmount);
  if (!commercialLineCount && !incompleteCommercialLine) this.commercialTotalStatus = "NOT_APPLICABLE";
  else if (incompleteCommercialLine || commercialLineCount !== (this.lines || []).length) this.commercialTotalStatus = "INCOMPLETE";
  else this.commercialTotalStatus = moneyEquals(this.totalCommercialAmount, this.totalAmount) ? "MATCH" : "MISMATCH";

  const mobilityLines = this.rendition?.mobilityLines || [];
  const unsupportedLines = this.rendition?.unsupportedExpenseLines || [];
  for (const line of mobilityLines) line.amount = roundMoney(line.amount);
  for (const line of unsupportedLines) line.grossAmount = roundMoney(line.grossAmount);
  if (this.rendition) {
    this.rendition.mobilitySubtotal = sumMoney(mobilityLines.map((line) => line.amount));
    this.rendition.unsupportedExpenseSubtotal = sumMoney(unsupportedLines.map((line) => line.grossAmount));
    this.rendition.reimbursementTotal = sumMoney([
      this.rendition.mobilitySubtotal,
      this.rendition.unsupportedExpenseSubtotal
    ]);
    const hasOfficialDetails = mobilityLines.length > 0 || unsupportedLines.length > 0;
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
