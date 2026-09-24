import { assertPostingAllowed } from "./financialProgressService.js";
import { assertBudgetBeforePosting, executeBudgetAmount } from "./budgetService.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { assertVoucherXmlMatches } from "./xmlValidationService.js";
import { validateVoucherWithSunat, createSunatVoucher, findDuplicateVoucher } from "./sunatVoucherService.js";
import AccountsPayable from "../models/AccountsPayable.js";
import { resolvePayablePaymentTerms, resolvePayableDueDate } from "./payablePaymentTermsService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { assertPurchaseOrderInvoiceFits, consumePurchaseOrderBalance } from "./purchaseOrderMatchingService.js";
import JournalEntry from "../models/JournalEntry.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { requireAccountingMapping } from "./accountingMappingService.js";
import { recordAudit } from "./auditService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { applyExchangeRate, resolveExchangeRateSnapshot } from "./exchangeRateService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { notifyRoles, resolveNotification } from "./notificationService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import {
  AP_STATUS,
  DOCUMENT_PHASE,
  ERROR_CODES,
  FLOW_TYPE,
  MANDATORY_XML_TYPES,
  REQUEST_STATUS,
  REQUEST_TYPE
} from "../utils/constants.js";
import { addMoney, moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function fiscalPayload(body, supplierIdentifier) {
  const voucherType = normalizeToken(body.voucherType || body.documentType);
  const series = normalizeToken(body.series);
  const number = normalizeToken(body.number);
  const required = {
    voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate,
    fiscalPeriod: body.fiscalPeriod
  };
  const missing = Object.entries(required).filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
  if (missing.length) {
    throw new AppError(422, "Required fiscal fields are missing.", { missing }, ERROR_CODES.VALIDATION_ERROR);
  }
  return {
    supplierIdentifierNormalized: normalizeToken(supplierIdentifier),
    voucherType,
    documentType: voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate,
    fiscalPeriod: body.fiscalPeriod,
    accountNumber: String(body.accountNumber || "").trim(),
    subaccountNumber: String(body.subaccountNumber || "").trim(),
    comments: String(body.comments || "").trim()
  };
}

function debitLine({ accountNumber, subAccount = "", description, costCenter, expenseType, amount }) {
  return { accountNumber, subAccount, description, costCenter, expenseType, debit: roundMoney(amount), credit: 0 };
}

function creditLine({ accountNumber, subAccount = "", description, amount }) {
  return { accountNumber, subAccount, description, debit: 0, credit: roundMoney(amount) };
}

function adjustDebitsToTotal(lines, target) {
  const current = sumMoney(lines.map((line) => line.debit));
  const difference = subtractMoney(target, current);
  if (!moneyEquals(difference, 0)) {
    const lastDebit = [...lines].reverse().find((line) => line.debit > 0);
    if (!lastDebit) throw new AppError(422, "The provision has no debit line.", undefined, ERROR_CODES.VALIDATION_ERROR);
    lastDebit.debit = addMoney(lastDebit.debit, difference);
  }
}

async function provisionJournalLines(request) {
  await request.populate("lines.expenseType");
  const total = request.totalPENEquivalent ?? request.penEquivalent;
  const payable = await requireAccountingMapping("ACCOUNTS_PAYABLE", request);
  const lines = [];

  if (request.requestType === REQUEST_TYPE.ENTREGA_RENDIR) {
    const transit = await requireAccountingMapping("ADVANCE_TRANSIT", request);
    lines.push(debitLine({
      accountNumber: transit.accountNumber,
      subAccount: transit.subAccount,
      description: `Advance receivable for ${request.requestNumber}`,
      amount: total
    }));
  } else if (request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO) {
    for (const line of request.lines) {
      lines.push(debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Non-deductible reimbursement ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: line.penEquivalent
      }));
    }
  } else {
    const igvMapping = request.totalIGV > 0 ? await requireAccountingMapping("IGV", request) : null;
    for (const line of request.lines) {
      const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
      const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
      if (netPen > 0) {
        lines.push(debitLine({
          accountNumber: line.expenseType.accountNumber,
          subAccount: line.subAccount || "",
          description: `${request.requestType} provision ${request.requestNumber}`,
          costCenter: line.costCenter,
          expenseType: line.expenseType._id,
          amount: netPen
        }));
      }
      if (igvPen > 0) {
        lines.push(debitLine({
          accountNumber: igvMapping.accountNumber,
          subAccount: igvMapping.subAccount,
          description: `Recoverable IGV ${request.requestNumber}`,
          costCenter: line.costCenter,
          expenseType: line.expenseType._id,
          amount: igvPen
        }));
      }
    }
  }
  adjustDebitsToTotal(lines, total);
  lines.push(creditLine({
    accountNumber: payable.accountNumber,
    subAccount: payable.subAccount,
    description: `Accounts payable ${request.requestNumber}`,
    amount: total
  }));
  return lines;
}

async function createJournal({ request, accountsPayable, entryType, sourceTransaction, lines, userId, originalAmount, currency, exchangeRate, penEquivalent, period, session }) {
  if (period) await guardAccountingPeriod({ period, action: "POST", user: { _id: userId }, module: "ACCOUNTING", requestId: request._id });
  await assertPostingAllowed(request, { user: { _id: userId } });
  if (["PROVISION", "ADVANCE", "RENDITION"].includes(entryType)) await assertBudgetBeforePosting(request, { session, userId });
  const identity = accountsPayable?._id
    ? { accountsPayable: accountsPayable._id, entryType, sourceTransaction }
    : { request: request._id, entryType, sourceTransaction };
  const existing = await JournalEntry.findOne(identity).session(session || null);
  if (existing) return existing;
  if (entryType === "PROVISION" && request.flowType !== FLOW_TYPE.C) {
    const evidence = await SunatVoucher.findById(accountsPayable?.sunatVoucher).select("+xmlPath").session(session || null);
    const fiscal = evidence?.validationEvidence?.fiscal;
    if (!evidence?.validationEvidence?.valid || !fiscal?.valid || fiscal.voucherVerified === false || fiscal.publicDataset || (process.env.NODE_ENV === "production" && fiscal.source === "MOCK")) {
      throw new AppError(422, "Individual invoice validation evidence is required before posting.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
    }
    await assertVoucherXmlMatches(evidence.xmlPath, {
      ruc: accountsPayable.supplierIdentifierSnapshot, series: accountsPayable.voucher.series, number: accountsPayable.voucher.number,
      issueDate: accountsPayable.voucher.documentDate, currency: accountsPayable.currency,
      netAmount: evidence.netAmount, igvAmount: evidence.igvAmount, totalAmount: accountsPayable.originalAmount
    });
  }
  const totalDebit = sumMoney(lines.map((line) => line.debit));
  const totalCredit = sumMoney(lines.map((line) => line.credit));
  if (!moneyEquals(totalDebit, totalCredit)) {
    throw new AppError(422, "Accounting journal is not balanced.", { totalDebit, totalCredit }, ERROR_CODES.VALIDATION_ERROR);
  }
  const [journal] = await JournalEntry.create([{
    request: request._id,
    accountsPayable: accountsPayable?._id,
    period: period || request.fiscalData?.fiscalPeriod || request.accountingPeriod,
    entryType,
    sourceTransaction,
    currency: currency || request.currency,
    originalAmount: roundMoney(originalAmount ?? request.totalAmount),
    exchangeRate: Number(exchangeRate ?? request.exchangeRate ?? 1),
    exchangeRateEvidence: accountsPayable?.exchangeRateEvidence || request.exchangeRateEvidence,
    penEquivalent: roundMoney(penEquivalent ?? request.totalPENEquivalent ?? request.penEquivalent),
    lines,
    totalDebit,
    totalCredit,
    status: "POSTED",
    postedAt: new Date(),
    generatedBy: userId
  }], session ? { session } : undefined);
  await recordAudit({ entityType: "JournalEntry", entity: journal, requestId: request._id,
    action: "ACCOUNTING_POSTED", user: { _id: userId }, module: "ACCOUNTING", session,
    statusFrom: request.status, statusTo: request.status,
    comments: `${entryType} journal ${journal.entryNumber} posted.`,
    oldValues: { journalStatus: null }, newValues: { journalStatus: journal.status, entryType, accountsPayable: accountsPayable?._id, period: journal.period } });
  return journal;
}

export async function createProvisionJournal(request, accountsPayable, userId, { session } = {}) {
  const entryType = request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "ADVANCE" : "PROVISION";
  return createJournal({
    request,
    accountsPayable,
    entryType,
    sourceTransaction: `CXP:${request.requestNumber}`,
    lines: await provisionJournalLines(request),
    userId,
    session
  });
}

async function provisionJournalLinesForVoucher(request, voucherAmount) {
  await request.populate("lines.expenseType");
  const total = roundMoney(voucherAmount.totalAmount);
  const net = roundMoney(voucherAmount.netAmount ?? total);
  const igv = roundMoney(voucherAmount.igvAmount || 0);
  const exchangeRate = Number(voucherAmount.exchangeRate ?? request.exchangeRate ?? 1);
  const payable = await requireAccountingMapping("ACCOUNTS_PAYABLE", request);
  const igvMapping = igv > 0 ? await requireAccountingMapping("IGV", request) : null;
  const requestNetTotal = sumMoney((request.lines || []).map((line) => line.netAmount));
  const requestLineTotal = sumMoney((request.lines || []).map((line) => line.totalAmount));
  const basis = requestNetTotal > 0 ? requestNetTotal : requestLineTotal;
  const lines = [];
  let allocatedNet = 0;
  for (const [index, line] of (request.lines || []).entries()) {
    const lineBasis = requestNetTotal > 0 ? Number(line.netAmount || 0) : Number(line.totalAmount || 0);
    const share = basis > 0 ? lineBasis / basis : 1 / Math.max(1, request.lines.length);
    const isLast = index === request.lines.length - 1;
    const sourceAmount = isLast ? subtractMoney(net, allocatedNet) : roundMoney(net * share);
    allocatedNet = addMoney(allocatedNet, sourceAmount);
    const pen = multiplyMoney(sourceAmount, exchangeRate);
    if (pen > 0) {
      lines.push(debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Invoice provision ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: pen
      }));
    }
  }
  if (igv > 0) {
    lines.push(debitLine({
      accountNumber: igvMapping.accountNumber,
      subAccount: igvMapping.subAccount,
      description: `Recoverable IGV ${request.requestNumber}`,
      costCenter: request.lines?.[0]?.costCenter,
      expenseType: request.lines?.[0]?.expenseType?._id,
      amount: multiplyMoney(igv, exchangeRate)
    }));
  }
  const penTotal = multiplyMoney(total, exchangeRate);
  adjustDebitsToTotal(lines, penTotal);
  lines.push(creditLine({
    accountNumber: payable.accountNumber,
    subAccount: payable.subAccount,
    description: `Accounts payable ${request.requestNumber}`,
    amount: penTotal
  }));
  return lines;
}

export async function createProvisionJournalForVoucher(request, accountsPayable, voucherAmount, userId, { session } = {}) {
  const exchangeRate = Number(voucherAmount.exchangeRate ?? request.exchangeRate ?? 1);
  const totalAmount = roundMoney(voucherAmount.totalAmount);
  return createJournal({
    request,
    accountsPayable,
    entryType: request.requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "ADVANCE" : "PROVISION",
    sourceTransaction: `CXP:${request.requestNumber}:${accountsPayable._id}`,
    lines: request.requestType === REQUEST_TYPE.ENTREGA_RENDIR
      ? await provisionJournalLines(request)
      : await provisionJournalLinesForVoucher(request, { ...voucherAmount, exchangeRate }),
    userId,
    originalAmount: totalAmount,
    exchangeRate,
    penEquivalent: multiplyMoney(totalAmount, exchangeRate),
    session
  });
}

export async function createPaymentJournal(request, accountsPayable, userId, { bank, paymentDate, session } = {}) {
  const [payable, bankMapping] = await Promise.all([
    requireAccountingMapping("ACCOUNTS_PAYABLE", request),
    requireAccountingMapping("BANK", request, { bank, currency: request.currency })
  ]);
  const sourceAmount = roundMoney(accountsPayable?.originalAmount ?? request.totalAmount);
  const rate = Number(accountsPayable?.exchangeRate ?? request.exchangeRate ?? 1);
  const amount = roundMoney(accountsPayable?.penEquivalent ?? multiplyMoney(sourceAmount, rate));
  return createJournal({
    request,
    accountsPayable,
    entryType: "PAYMENT",
    period: paymentDate ? new Date(paymentDate).toISOString().slice(0, 7) : undefined,
    sourceTransaction: `PAYMENT:${request.payment?.operationNumber || request.requestNumber}:${accountsPayable?._id || ""}`,
    lines: [
      debitLine({ accountNumber: payable.accountNumber, subAccount: payable.subAccount, description: `Settle CXP ${request.requestNumber}`, amount }),
      creditLine({ accountNumber: bankMapping.accountNumber, subAccount: bankMapping.subAccount, description: `Bank payment ${request.requestNumber}`, amount })
    ],
    userId,
    originalAmount: sourceAmount,
    exchangeRate: rate,
    penEquivalent: amount,
    session
  });
}

export async function createAccountsPayableFromVoucher({
  request,
  supplier,
  voucher,
  purchaseOrder,
  sunatVoucher,
  sourceBatch,
  dueDate,
  user,
  paymentPriority = "NORMAL",
  flowType,
  session
}) {
  await assertPostingAllowed(request, { user });
  const supplierId = supplier?._id || supplier || request.supplier?._id || request.supplier;
  const supplierIdentifier = voucher.ruc || supplier?.normalizedIdentifier || supplier?.rucDni || request.supplierSnapshot?.identifier || request.rendition?.beneficiarySnapshot?.employeeCode || request.requester?.email || request.requestNumber;
  const series = normalizeToken(voucher.series || String(voucher.invoiceNumber || "").split("-")[0]);
  const number = normalizeToken(voucher.number || String(voucher.invoiceNumber || "").split("-").slice(1).join("-"));
  const voucherType = normalizeToken(voucher.voucherType || voucher.documentType || "FACTURA");
  const existing = await AccountsPayable.findOne({
    supplierIdentifierSnapshot: normalizeToken(supplierIdentifier),
    "voucher.voucherType": voucherType,
    "voucher.series": series,
    "voucher.number": number
  }).session(session || null);
  if (existing) {
    const sameRequest = String(existing.request) === String(request._id);
    const samePurchaseOrder = !purchaseOrder || String(existing.purchaseOrder || "") === String(purchaseOrder?._id || purchaseOrder);
    const sameBatch = !sourceBatch || String(existing.sourceBatch || "") === String(sourceBatch?._id || sourceBatch);
    const sameVoucher = !sunatVoucher || String(existing.sunatVoucher || "") === String(sunatVoucher?._id || sunatVoucher);
    if (sameRequest && samePurchaseOrder && sameBatch && sameVoucher) return existing;
    throw new AppError(409, "The fiscal voucher is already registered in Accounts Payable.", { accountsPayable: existing._id, request: existing.request }, ERROR_CODES.DUPLICATE_VOUCHER);
  }
  let validatedVoucher;
  const total = roundMoney(voucher.totalAmount);
  const rateEvidence = request.flowType === FLOW_TYPE.C ? request.exchangeRateEvidence : await resolveExchangeRateSnapshot(voucher.currency || request.currency, voucher.issueDate || request.issueDate);
  const exchangeRate = Number(rateEvidence?.rate || request.exchangeRate || 1);
  await assertBudgetBeforePosting(request, { session, userId: user?._id || user, amount: multiplyMoney(total, exchangeRate), allowFxTopUp: (voucher.currency || request.currency) === "USD", exchangeRateEvidence: rateEvidence });
  if (request.flowType !== FLOW_TYPE.C) {
    const evidence = await SunatVoucher.findById(sunatVoucher?._id || sunatVoucher).select("+xmlPath").session(session || null);
    await assertVoucherXmlMatches(evidence?.xmlPath, voucher);
    const fiscalValidation = await validateVoucherWithSunat(voucher, { request, user });
    if (!fiscalValidation.valid) throw new AppError(422, fiscalValidation.detail, { validation: fiscalValidation }, ERROR_CODES.XML_VALIDATION_FAILED);
    validatedVoucher = evidence;
    evidence.validationEvidence = fiscalValidation;
    await evidence.save({ session });
    request.fiscalValidation = fiscalValidation;
  }
  const paymentTermsSnapshot = await resolvePayablePaymentTerms({ request, supplier, purchaseOrder, session });
  const [accountsPayable] = await AccountsPayable.create([{
    request: request._id,
    purchaseOrder: purchaseOrder?._id || purchaseOrder,
    sunatVoucher: sunatVoucher?._id || sunatVoucher,
    sourceBatch: sourceBatch?._id || sourceBatch,
    flowType: flowType || request.flowType,
    supplier: supplierId,
    supplierIdentifierSnapshot: normalizeToken(supplierIdentifier),
    beneficiarySnapshot: request.flowType === FLOW_TYPE.C ? {
      user: request.requester?._id || request.requester || request.solicitor,
      employeeCode: request.rendition?.beneficiarySnapshot?.employeeCode,
      name: request.rendition?.beneficiarySnapshot?.name,
      email: request.rendition?.beneficiarySnapshot?.email
    } : undefined,
    voucher: {
      voucherType,
      documentType: voucherType,
      series,
      number,
      documentDate: voucher.issueDate || voucher.documentDate
    },
    originalAmount: total,
    currency: voucher.currency || request.currency,
    exchangeRate,
    exchangeRateEvidence: rateEvidence,
    penEquivalent: multiplyMoney(total, exchangeRate),
    outstandingAmount: total,
    dueDate: resolvePayableDueDate({
      dueDate,
      voucher,
      paymentTermsSnapshot,
      flowType: flowType || request.flowType
    }),
    paymentTermsSnapshot,
    paymentPriority,
    status: AP_STATUS.OPEN,
    history: [{ status: AP_STATUS.OPEN, by: user?._id || user, comments: "CXP created after automated fiscal validation." }]
  }], session ? { session } : undefined);
  const journal = await createProvisionJournalForVoucher(request, accountsPayable, {
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    totalAmount: total,
    exchangeRate
  }, user?._id || user, { session });
  accountsPayable.provisionJournal = journal._id;
  if (request.flowType !== FLOW_TYPE.C && !accountsPayable.budgetExecutedAt) {
    await executeBudgetAmount(request, user?._id || user, accountsPayable.penEquivalent, { session });
    accountsPayable.budgetExecutedAt = new Date();
  }
  await accountsPayable.save({ session });
  if (validatedVoucher) {
    validatedVoucher.accountsPayable = accountsPayable._id;
    validatedVoucher.provisionedAt = new Date();
    await validatedVoucher.save({ session });
  }
  request.accountsPayables ||= [];
  if (!request.accountsPayables.some((id) => String(id) === String(accountsPayable._id))) request.accountsPayables.push(accountsPayable._id);
  request.accountsPayable ||= accountsPayable._id;
  return accountsPayable;
}

export async function createRenditionJournal(request, accountsPayable, userId, { session } = {}) {
  await request.populate("rendition.lines.expenseType");
  const deductibleLines = (request.rendition.lines || []).filter((line) => line.expenseType?.deductible !== false);
  const deductibleIgv = deductibleLines.reduce((sum, line) => addMoney(sum, line.igvAmount), 0);
  const [transit, igvMapping, returnedMapping] = await Promise.all([
    requireAccountingMapping("ADVANCE_TRANSIT", request),
    Number(deductibleIgv) > 0 ? requireAccountingMapping("IGV", request) : Promise.resolve(null),
    request.rendition.amountReturned > 0 ? requireAccountingMapping("RETURN_RECEIVABLE", request) : Promise.resolve(null)
  ]);
  const lines = [];
  for (const line of deductibleLines) {
    const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
    const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
    if (netPen > 0) {
      lines.push(debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Rendition expense ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: netPen
      }));
    }
    if (igvPen > 0) {
      lines.push(debitLine({
        accountNumber: igvMapping.accountNumber,
        subAccount: igvMapping.subAccount,
        description: `Rendition IGV ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: igvPen
      }));
    }
  }
  if (request.rendition.amountReturned > 0) {
    lines.push(debitLine({
      accountNumber: returnedMapping.accountNumber,
      subAccount: returnedMapping.subAccount,
      description: `Returned advance funds ${request.requestNumber}`,
      amount: multiplyMoney(request.rendition.amountReturned, request.exchangeRate)
    }));
  }
  const deductibleRendered = sumMoney(deductibleLines.map((line) => line.totalAmount || 0));
  const clearedSourceAmount = addMoney(deductibleRendered, request.rendition.amountReturned || 0);
  const clearedPen = multiplyMoney(clearedSourceAmount, request.exchangeRate);
  if (!(clearedPen > 0)) return null;
  adjustDebitsToTotal(lines, clearedPen);
  lines.push(creditLine({
    accountNumber: transit.accountNumber,
    subAccount: transit.subAccount,
    description: `Clear eligible advance receivable ${request.requestNumber}`,
    amount: clearedPen
  }));
  return createJournal({
    request,
    accountsPayable,
    entryType: "RENDITION",
    sourceTransaction: `RENDITION:${request.requestNumber}`,
    lines,
    userId,
    originalAmount: clearedSourceAmount,
    exchangeRate: request.exchangeRate,
    penEquivalent: clearedPen,
    session
  });
}

export async function createRenditionSettlementJournal(request, accountsPayable, { amount, method, reference }, userId, { session } = {}) {
  const sourceAmount = roundMoney(amount);
  if (!(sourceAmount > 0)) throw new AppError(422, "Settlement amount must be greater than zero.", { amount }, ERROR_CODES.VALIDATION_ERROR);
  const [transit, returnedMapping] = await Promise.all([
    requireAccountingMapping("ADVANCE_TRANSIT", request),
    requireAccountingMapping("RETURN_RECEIVABLE", request)
  ]);
  const penAmount = multiplyMoney(sourceAmount, request.exchangeRate);
  const sourceTransaction = `RENDITION_SETTLEMENT:${request.requestNumber}:${String(reference || Date.now()).trim()}`;
  return createJournal({
    request,
    accountsPayable,
    entryType: "RENDITION_SETTLEMENT",
    sourceTransaction,
    lines: [
      debitLine({
        accountNumber: returnedMapping.accountNumber,
        subAccount: returnedMapping.subAccount,
        description: `${method === "PAYROLL_DEDUCTION" ? "Payroll deduction" : "Employee reimbursement"} ${request.requestNumber}`,
        amount: penAmount
      }),
      creditLine({
        accountNumber: transit.accountNumber,
        subAccount: transit.subAccount,
        description: `Clear non-deductible advance balance ${request.requestNumber}`,
        amount: penAmount
      })
    ],
    userId,
    originalAmount: sourceAmount,
    exchangeRate: request.exchangeRate,
    penEquivalent: penAmount,
    session
  });
}

export async function processAccountsPayable({ requestId, payload, user, req }) {
  const request = await FinancialRequest.findById(requestId).select("+attachments.path").populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (request.status !== REQUEST_STATUS.BUDGET_COMMITTED) {
    throw new AppError(409, "Only budget-committed requests can be processed by Accounting.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (
    request.requestType === REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO
    && request.rendition?.number
    && (request.rendition?.status !== "VALIDATED" || request.rendition?.financeReview?.result !== "APPROVED")
  ) {
    throw new AppError(
      422,
      "The official unsupported-reimbursement detail requires Finance approval before Accounting processing.",
      { renditionStatus: request.rendition?.status, financeReview: request.rendition?.financeReview?.result },
      ERROR_CODES.RENDITION_REQUIRED
    );
  }
  const supplierIdentifier = request.supplier?.normalizedIdentifier || request.supplier?.rucDni || request.supplierSnapshot?.identifier;
  const fiscal = fiscalPayload(payload, supplierIdentifier);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "ACCOUNT", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  if (fiscal.fiscalPeriod !== request.accountingPeriod) {
    await guardAccountingPeriod({ period: fiscal.fiscalPeriod, action: "ACCOUNT", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  }
  const duplicate = await AccountsPayable.findOne({
    request: { $ne: request._id },
    supplierIdentifierSnapshot: fiscal.supplierIdentifierNormalized,
    "voucher.voucherType": fiscal.voucherType,
    "voucher.series": fiscal.series,
    "voucher.number": fiscal.number
  });
  if (duplicate) {
    throw new AppError(409, "The supplier voucher is already registered.", { accountsPayable: duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);
  }
  const purchaseOrder = request.flowType === FLOW_TYPE.A1 ? await PurchaseOrder.findOne({ request: request._id }) : null;
  if (request.flowType === FLOW_TYPE.A1) {
    if (!purchaseOrder) throw new AppError(409, "Procurement must issue the approved order before A1 accounting.");
    await assertPurchaseOrderInvoiceFits(purchaseOrder._id, request.totalAmount, { currency: request.currency });
  }
  await applyExchangeRate(request);
  await assertBudgetBeforePosting(request, { userId: user._id, amount: multiplyMoney(request.totalAmount, request.exchangeRate) });
  if (request.flowType !== FLOW_TYPE.C) {
    const xml = [...(request.attachments || [])].reverse().find(item => item.kind === "XML");
    const voucher = { ruc: supplierIdentifier, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number, issueDate: fiscal.documentDate, currency: request.currency, netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount };
    await assertVoucherXmlMatches(xml?.path, voucher);
    const validation = await validateVoucherWithSunat(voucher, { request, user });
    if (!validation.valid) throw new AppError(422, validation.detail, { validation }, ERROR_CODES.XML_VALIDATION_FAILED);
    request.fiscalValidation = validation;
  }
  await validateAccountingDimensions({ requestType: request.requestType, expenseNature: request.expenseNature, lines: request.lines, user });
  await assertConfiguredDocuments(request, DOCUMENT_PHASE.ACCOUNTING);
  if (MANDATORY_XML_TYPES.includes(request.requestType) && !request.xmlValidation?.validated) {
    throw new AppError(422, "A valid XML fiscal document is required before Accounting processing.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }


  const paymentTermsSnapshot = await resolvePayablePaymentTerms({ request, supplier: request.supplier });

  const result = await runFinancialOperation(async (session) => {
    request.fiscalData = { ...fiscal, processedAt: new Date(), processedBy: user._id };
    let accountsPayable = await AccountsPayable.findOne({ request: request._id }).session(session || null);
    if (!accountsPayable) {
      [accountsPayable] = await AccountsPayable.create([{
        request: request._id,
        flowType: request.flowType,
        purchaseOrder: purchaseOrder?._id,
        supplier: request.supplier._id,
        supplierIdentifierSnapshot: fiscal.supplierIdentifierNormalized,
        voucher: {
          voucherType: fiscal.voucherType,
          documentType: fiscal.documentType,
          series: fiscal.series,
          number: fiscal.number,
          documentDate: fiscal.documentDate
        },
        originalAmount: request.totalAmount,
        currency: request.currency,
        exchangeRate: request.exchangeRate,
        exchangeRateEvidence: request.exchangeRateEvidence,
        penEquivalent: request.totalPENEquivalent ?? request.penEquivalent,
        outstandingAmount: request.totalAmount,
        dueDate: resolvePayableDueDate({ dueDate: payload.dueDate, voucher: fiscal, paymentTermsSnapshot, flowType: request.flowType }),
        paymentTermsSnapshot,
        status: AP_STATUS.OPEN,
        history: [{ status: AP_STATUS.OPEN, by: user._id, comments: "CXP created after fiscal validation." }]
      }], session ? { session } : undefined);
      if (purchaseOrder) await consumePurchaseOrderBalance(purchaseOrder._id, request.totalAmount, { session });
    }
    if (request.flowType !== FLOW_TYPE.C) {
      const voucher = { ruc: supplierIdentifier, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number, issueDate: fiscal.documentDate, currency: request.currency, netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount };
      let evidence = await findDuplicateVoucher(voucher, { session });
      if (evidence && String(evidence.request) !== String(request._id)) throw new AppError(409, "Fiscal document already registered.", undefined, ERROR_CODES.DUPLICATE_VOUCHER);
      if (!evidence) evidence = await createSunatVoucher({ request, supplier: request.supplier, voucher, validationStatus: "VALID", sunatResult: request.fiscalValidation, xmlFile: [...request.attachments].reverse().find(item => item.kind === "XML"), user, session });
      evidence.accountsPayable = accountsPayable._id;
      evidence.provisionedAt = new Date();
      evidence.validationEvidence = request.fiscalValidation;
      evidence.validationStatus = "VALID";
      await evidence.save({ session });
      accountsPayable.sunatVoucher = evidence._id;
    }
    const journal = await createProvisionJournal(request, accountsPayable, user._id, { session });
    accountsPayable.provisionJournal = journal._id;
    if (request.flowType !== FLOW_TYPE.C && !accountsPayable.budgetExecutedAt) {
      await executeBudgetAmount(request, user._id, accountsPayable.penEquivalent, { session });
      accountsPayable.budgetExecutedAt = new Date();
    }
    await accountsPayable.save({ session });
    request.accountsPayable = accountsPayable._id;
    request.accountsPayables ||= [];
    if (!request.accountsPayables.some((id) => String(id) === String(accountsPayable._id))) {
      request.accountsPayables.push(accountsPayable._id);
    }
    await transitionRequest({
      request,
      targetStatus: REQUEST_STATUS.ACCOUNTED,
      user,
      req,
      action: "ACCOUNTED",
      comments: payload.comments || "Fiscal validation completed, balanced provision posted, and CXP created.",
      session
    });
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "CREATED",
      user,
      req,
      module: "ACCOUNTING",
      newValues: {
        status: accountsPayable.status,
        voucher: accountsPayable.voucher,
        provisionJournal: journal.entryNumber,
        paymentTermsSnapshot: accountsPayable.paymentTermsSnapshot,
        dueDate: accountsPayable.dueDate
      },
      session
    });
    return { request, accountsPayable, journal };
  });
  await resolveNotification(`request:${request._id}:accounting`);
  await notifyRoles({
    roles: ["Treasury"],
    eventKey: `request:${request._id}:treasury`,
    type: "TREASURY_PAYABLE",
    title: "Payable item ready",
    message: `${request.requestNumber} has an open CXP ready for Treasury scheduling.`,
    path: "/treasury",
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return result;
}

export async function generateProvisionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createProvisionJournal(request, ap, userId, options)];
}

export async function generatePaymentEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createPaymentJournal(request, ap, userId, options)];
}

export async function generateRenditionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id });
  return [await createRenditionJournal(request, ap, userId, options)];
}

export const applyCurrencyConversion = applyExchangeRate;

export async function getConsolidation(period) {
  const eligibleStatuses = [
    REQUEST_STATUS.ACCOUNTED,
    REQUEST_STATUS.SCHEDULED,
    REQUEST_STATUS.BANK_FILE_GENERATED,
    REQUEST_STATUS.PAID,
    REQUEST_STATUS.RECONCILED,
    REQUEST_STATUS.CLOSED
  ];
  const [sourceRows, journalRows, sourceSummary, journalSummary] = await Promise.all([
    FinancialRequest.aggregate([
      { $match: { accountingPeriod: period, status: { $in: eligibleStatuses } } },
      { $unwind: "$lines" },
      { $lookup: { from: "expensetypes", localField: "lines.expenseType", foreignField: "_id", as: "expense" } },
      { $unwind: { path: "$expense", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { costCenter: "$lines.costCenter", expenseType: "$lines.expenseType", accountNumber: "$expense.accountNumber" },
          netAmount: { $sum: { $multiply: ["$lines.netAmount", "$exchangeRate"] } },
          igvAmount: { $sum: { $multiply: ["$lines.igvAmount", "$exchangeRate"] } },
          totalAmount: { $sum: "$lines.penEquivalent" },
          penEquivalent: { $sum: "$lines.penEquivalent" },
          requests: { $addToSet: "$_id" }
        }
      }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { costCenter: "$lines.costCenter", expenseType: "$lines.expenseType", accountNumber: "$lines.accountNumber" },
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" }
        }
      }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $group: { _id: null, total: { $sum: "$totalDebit" }, requests: { $addToSet: "$request" } } },
      { $project: { total: 1, count: { $size: "$requests" } } }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE", "RENDITION"] } } },
      { $group: { _id: null, totalDebit: { $sum: "$totalDebit" }, totalCredit: { $sum: "$totalCredit" } } }
    ])
  ]);
  const rowMap = new Map();
  const keyOf = (row) => `${row._id.costCenter || ""}|${row._id.expenseType || ""}|${row._id.accountNumber || ""}`;
  for (const row of sourceRows) {
    rowMap.set(keyOf(row), {
      period,
      costCenter: row._id.costCenter,
      expenseType: row._id.expenseType,
      accountNumber: row._id.accountNumber || "",
      currency: "PEN",
      netAmount: roundMoney(row.netAmount),
      igvAmount: roundMoney(row.igvAmount),
      totalAmount: roundMoney(row.totalAmount),
      penEquivalent: roundMoney(row.penEquivalent),
      requestCount: row.requests.length,
      debit: 0,
      credit: 0
    });
  }
  for (const row of journalRows) {
    const key = keyOf(row);
    const current = rowMap.get(key) || {
      period,
      costCenter: row._id.costCenter,
      expenseType: row._id.expenseType,
      accountNumber: row._id.accountNumber || "",
      currency: "PEN",
      netAmount: 0,
      igvAmount: 0,
      totalAmount: 0,
      penEquivalent: 0,
      requestCount: 0,
      debit: 0,
      credit: 0
    };
    current.debit = roundMoney(row.debit);
    current.credit = roundMoney(row.credit);
    rowMap.set(key, current);
  }
  const transactionSourceTotal = roundMoney(sourceSummary[0]?.total || 0);
  const centralizationTotal = roundMoney(journalSummary[0]?.totalDebit || 0);
  return {
    rows: [...rowMap.values()],
    summary: {
      transactionSourceTotal,
      centralizationTotal,
      totalDebit: centralizationTotal,
      totalCredit: roundMoney(journalSummary[0]?.totalCredit || 0),
      difference: subtractMoney(transactionSourceTotal, centralizationTotal),
      requestCount: sourceSummary[0]?.count || 0,
      balanced: moneyEquals(centralizationTotal, journalSummary[0]?.totalCredit || 0)
    }
  };
}
