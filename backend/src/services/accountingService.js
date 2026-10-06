import mongoose from "mongoose";
import { assertPostingAllowed, syncFinancialProgress } from "./financialProgressService.js";
import { assertBudgetBeforePosting, executeBudgetAmount, reverseBudgetExecution } from "./budgetService.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { assertVoucherEvidenceMatches, latestInvoiceEvidence } from "./xmlValidationService.js";
import {
  createSunatVoucher,
  findDuplicateVoucher,
  hasManualSunatException,
  manualExceptionEvidence,
  validateVoucherWithSunat,
  voucherIdentity
} from "./sunatVoucherService.js";
import AccountsPayable from "../models/AccountsPayable.js";
import ExpenseType from "../models/ExpenseType.js";
import { resolvePayablePaymentTerms, resolvePayableDueDate } from "./payablePaymentTermsService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { assertPurchaseOrderInvoiceFits, consumePurchaseOrderBalance, requiresPurchaseOrder, restorePurchaseOrderBalance } from "./purchaseOrderMatchingService.js";
import JournalEntry from "../models/JournalEntry.js";
import { validateAccountingDimensions } from "./accountingDimensionService.js";
import { requireAccountingMapping, resolveAccountingMapping } from "./accountingMappingService.js";
import { recordAudit } from "./auditService.js";
import { assertConfiguredDocuments } from "./documentRuleService.js";
import { applyExchangeRate, resolveExchangeRateSnapshot } from "./exchangeRateService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { notificationText, notifyRoles, resolveNotification } from "./notificationService.js";
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
import {
  NON_CREDITABLE_IGV_VOUCHER_TYPES,
  canonicalSeries,
  canonicalVoucherNumber,
  canonicalVoucherType,
  isAdjustmentNote,
  voucherNumberPattern,
  voucherTypeVariants
} from "../utils/voucherIdentity.js";

// Largest rounding residual (in the journal currency, PEN) a provision may absorb on its expense
// line. Anything larger means net + IGV does not add up to the document total and is rejected.
export const JOURNAL_RESIDUAL_TOLERANCE = 0.05;

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

// Invoices are booked in the period of their document date, never in the request's creation month.
export function invoicePostingPeriod(documentDate) {
  const period = periodFromDate(documentDate);
  if (!period) throw new AppError(422, "A valid invoice/document date is required to determine the accounting period.", { documentDate }, ERROR_CODES.VALIDATION_ERROR);
  return period;
}

function fiscalPayload(body, supplierIdentifier) {
  const voucherType = canonicalVoucherType(body.voucherType || body.documentType, "");
  const series = canonicalSeries(body.series);
  const number = canonicalVoucherNumber(body.number);
  const required = {
    voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate
  };
  const missing = Object.entries(required).filter(([, value]) => !String(value || "").trim()).map(([key]) => key);
  if (missing.length) {
    throw new AppError(422, "Required fiscal fields are missing.", { missing }, ERROR_CODES.VALIDATION_ERROR);
  }
  const postingPeriod = invoicePostingPeriod(body.documentDate);
  const requestedPeriod = String(body.fiscalPeriod || "").trim();
  if (requestedPeriod && requestedPeriod !== postingPeriod) {
    throw new AppError(
      422,
      `Invoices are booked in the period of their document date (${postingPeriod}); the fiscal period ${requestedPeriod} does not match.`,
      { fiscalPeriod: requestedPeriod, documentPeriod: postingPeriod },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return {
    supplierIdentifierNormalized: normalizeToken(supplierIdentifier),
    voucherType,
    documentType: voucherType,
    series,
    number,
    documentDate: body.documentDate,
    accountingDate: body.accountingDate,
    fiscalPeriod: postingPeriod,
    accountNumber: String(body.accountNumber || "").trim(),
    subaccountNumber: String(body.subaccountNumber || "").trim(),
    comments: String(body.comments || "").trim()
  };
}

// The posting account of a provision is the accounting account on each line: the platform's
// suggestion, or the one Accounting chose while processing the invoice. A free-typed account
// number is only accepted when it is one of those accounts.
export function assertPostingAccount(request, accountNumber) {
  const typed = String(accountNumber || "").trim();
  if (!typed) return;
  const configured = [...new Set((request.lines || []).map((line) => line.expenseType?.accountNumber).filter(Boolean).map(String))];
  if (configured.length && !configured.includes(typed)) {
    throw new AppError(
      422,
      `Account ${typed} is not the accounting account selected for this invoice (${configured.join(", ")}). Choose the account from the accounting account catalog.`,
      { accountNumber: typed, configured },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
}

// Accounting picks the account while processing the invoice; it replaces the platform suggestion
// on every line (or only on the lines listed in lineAccounts).
export async function applyAccountingAccounts(request, { accountingAccount, lineAccounts } = {}) {
  const byLine = new Map((Array.isArray(lineAccounts) ? lineAccounts : []).filter((item) => item?.line && item?.account).map((item) => [String(item.line), String(item.account)]));
  if (!accountingAccount && !byLine.size) return false;
  const chosen = [...new Set([accountingAccount, ...byLine.values()].filter(Boolean).map(String))];
  if (chosen.some((id) => !mongoose.isValidObjectId(id))) throw new AppError(422, "Select a valid accounting account.", { accountingAccount, lineAccounts }, ERROR_CODES.VALIDATION_ERROR);
  const accounts = new Map((await ExpenseType.find({ _id: { $in: chosen }, active: true })).map((item) => [String(item._id), item]));
  for (const line of request.lines || []) {
    const id = byLine.get(String(line._id)) || (accountingAccount ? String(accountingAccount) : "");
    if (!id) continue;
    const account = accounts.get(id);
    if (!account) throw new AppError(422, "Select an active accounting account.", { account: id }, ERROR_CODES.VALIDATION_ERROR);
    line.expenseType = account;
    line.accountSource = "ACCOUNTING";
  }
  return true;
}

function optionalBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

// SPOT and IGV treatment Accounting confirms for the invoice. Missing values keep the defaults:
// IGV follows the document type and SPOT follows the expense nature (see detractionService).
export function accountingTreatmentPayload(payload = {}, user) {
  const igvDeductible = optionalBoolean(payload.igvDeductible);
  const spotConfirmed = payload.spotCategoryCode !== undefined || optionalBoolean(payload.spotConfirmed) === true;
  const spotCategoryCode = String(payload.spotCategoryCode ?? "").trim();
  if (spotCategoryCode && !/^\d{3}$/.test(spotCategoryCode)) throw new AppError(422, "Select a valid SPOT category.", { spotCategoryCode }, ERROR_CODES.VALIDATION_ERROR);
  if (igvDeductible === undefined && !spotConfirmed) return undefined;
  return { igvDeductible, spotConfirmed, spotCategoryCode: spotConfirmed ? spotCategoryCode : "", confirmedBy: user?._id || user, confirmedAt: new Date() };
}

function debitLine({ accountNumber, subAccount = "", description, costCenter, expenseType, amount }) {
  return { accountNumber, subAccount, description, costCenter, expenseType, debit: roundMoney(amount), credit: 0 };
}

function creditLine({ accountNumber, subAccount = "", description, costCenter, expenseType, amount }) {
  return { accountNumber, subAccount, description, costCenter, expenseType, debit: 0, credit: roundMoney(amount) };
}

// IGV deductibility is decided by the document: boletas/tickets never give tax credit. On a
// creditable document Accounting may still mark the invoice's IGV as non-deductible
// (igvDeductible === false). Non-recoverable IGV is cost (or, for CAPEX, part of the asset cost).
export function igvIsRecoverable(voucherType, igvDeductible) {
  if (NON_CREDITABLE_IGV_VOUCHER_TYPES.includes(canonicalVoucherType(voucherType, ""))) return false;
  return igvDeductible !== false;
}

function requireLineAccount(request, line) {
  if (line.expenseType?.accountNumber) return line.expenseType;
  throw new AppError(422, `Select the accounting account of request ${request.requestNumber} before posting.`, { line: line._id }, ERROR_CODES.VALIDATION_ERROR);
}

function expenseDescription(prefix, requestNumber, expenseType, nonRecoverableIgv) {
  if (!(Number(nonRecoverableIgv) > 0)) return `${prefix} ${requestNumber}`;
  return expenseType?.category === "CAPEX"
    ? `${prefix} ${requestNumber} (asset cost incl. non-recoverable IGV)`
    : `${prefix} ${requestNumber} (incl. non-recoverable IGV)`;
}

export function assertDocumentTotals({ netAmount, igvAmount, totalAmount }) {
  const gap = subtractMoney(totalAmount, addMoney(netAmount || 0, igvAmount || 0));
  if (Math.abs(gap) > JOURNAL_RESIDUAL_TOLERANCE) {
    throw new AppError(
      422,
      `Net plus IGV (${addMoney(netAmount || 0, igvAmount || 0).toFixed(2)}) does not match the document total (${roundMoney(totalAmount).toFixed(2)}).`,
      { netAmount, igvAmount, totalAmount, difference: gap, tolerance: JOURNAL_RESIDUAL_TOLERANCE },
      ERROR_CODES.XML_AMOUNT_MISMATCH
    );
  }
}

// Rounding residuals (FX multiplication, allocation across lines) are absorbed by the largest
// expense/asset line - never the IGV line - and only within JOURNAL_RESIDUAL_TOLERANCE.
function settleResidual(lines, target, expenseLines = []) {
  const current = sumMoney(lines.map((line) => line.debit));
  const difference = subtractMoney(target, current);
  if (moneyEquals(difference, 0)) return;
  if (Math.abs(difference) > JOURNAL_RESIDUAL_TOLERANCE) {
    throw new AppError(
      422,
      "The journal lines do not add up to the document total; net plus IGV must equal the total.",
      { expected: target, lines: current, difference, tolerance: JOURNAL_RESIDUAL_TOLERANCE },
      ERROR_CODES.XML_AMOUNT_MISMATCH
    );
  }
  const candidates = (expenseLines.length ? expenseLines : lines).filter((line) => line.debit > 0);
  if (!candidates.length) throw new AppError(422, "The provision has no debit line.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const receiver = candidates.reduce((largest, line) => (line.debit > largest.debit ? line : largest));
  receiver.debit = addMoney(receiver.debit, difference);
}

async function provisionJournalLines(request, { voucherType, igvDeductible } = {}) {
  await request.populate("lines.expenseType");
  const total = request.totalPENEquivalent ?? request.penEquivalent;
  const payable = await requireAccountingMapping("ACCOUNTS_PAYABLE", request);
  const lines = [];
  const expenseLines = [];

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
      requireLineAccount(request, line);
      const expense = debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: `Non-deductible reimbursement ${request.requestNumber}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: line.penEquivalent
      });
      lines.push(expense);
      expenseLines.push(expense);
    }
  } else {
    const documentType = voucherType || request.fiscalData?.voucherType;
    const recoverable = () => igvIsRecoverable(documentType, igvDeductible ?? request.fiscalData?.igvDeductible);
    const igvMapping = (request.lines || []).some((line) => Number(line.igvAmount) > 0 && recoverable(line)) ? await requireAccountingMapping("IGV", request) : null;
    for (const line of request.lines) {
      const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
      const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
      const igvToCost = recoverable(line) ? 0 : igvPen;
      requireLineAccount(request, line);
      if (addMoney(netPen, igvToCost) > 0) {
        const expense = debitLine({
          accountNumber: line.expenseType.accountNumber,
          subAccount: line.subAccount || "",
          description: expenseDescription(`${request.requestType} provision`, request.requestNumber, line.expenseType, igvToCost),
          costCenter: line.costCenter,
          expenseType: line.expenseType._id,
          amount: addMoney(netPen, igvToCost)
        });
        lines.push(expense);
        expenseLines.push(expense);
      }
      if (igvPen > 0 && !igvToCost) {
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
  settleResidual(lines, total, expenseLines);
  lines.push(creditLine({
    accountNumber: payable.accountNumber,
    subAccount: payable.subAccount,
    description: `Accounts payable ${request.requestNumber}`,
    amount: total
  }));
  return lines;
}

async function createJournal({ request, accountsPayable, entryType, sourceTransaction, lines, userId, originalAmount, currency, exchangeRate, penEquivalent, period, allowClosedRequest = false, session }) {
  // Guard the period the posting actually lands in. Provisions land in their invoice's period;
  // the request's own creation month never decides where (or whether) a journal can be posted.
  const landingPeriod = period
    || (["PROVISION", "ADVANCE"].includes(entryType) ? accountsPayable?.accountingPeriod : undefined)
    || request.fiscalData?.fiscalPeriod
    || request.accountingPeriod;
  await guardAccountingPeriod({ period: landingPeriod, action: "POST", user: { _id: userId }, module: "ACCOUNTING", requestId: request._id });
  // Supplier-credit movements (a credit note on a paid invoice, its refund) may arrive after the
  // original request was closed; they post against the supplier, not the request's workflow.
  if (!allowClosedRequest) await assertPostingAllowed(request, { user: { _id: userId } });
  if (["PROVISION", "ADVANCE", "RENDITION"].includes(entryType)) await assertBudgetBeforePosting(request, { session, userId });
  const identity = accountsPayable?._id
    ? { accountsPayable: accountsPayable._id, entryType, sourceTransaction }
    : { request: request._id, entryType, sourceTransaction };
  const existing = await JournalEntry.findOne(identity).session(session || null);
  if (existing) return existing;
  if (entryType === "PROVISION" && request.flowType !== FLOW_TYPE.C) {
    const evidence = await SunatVoucher.findById(accountsPayable?.sunatVoucher).select("+xmlPath +pdfPath").session(session || null);
    const fiscal = evidence?.validationEvidence?.fiscal;
    // An audited manual SUNAT exception (SUNAT down / padrón-only mode) is the one accepted
    // substitute for an individually verified voucher.
    const manualException = hasManualSunatException(evidence) && fiscal?.manualException === true;
    if (!manualException && (!evidence?.validationEvidence?.valid || !fiscal?.valid || fiscal.voucherVerified === false || fiscal.publicDataset || (process.env.NODE_ENV === "production" && fiscal.source === "MOCK"))) {
      throw new AppError(422, "Individual invoice validation evidence is required before posting.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
    }
    await assertVoucherEvidenceMatches(evidence.xmlPath || evidence.pdfPath, {
      ruc: accountsPayable.supplierIdentifierSnapshot, series: accountsPayable.voucher.series, number: accountsPayable.voucher.number,
      issueDate: accountsPayable.voucher.documentDate, currency: accountsPayable.currency,
      netAmount: evidence.netAmount, igvAmount: evidence.igvAmount, totalAmount: accountsPayable.invoiceAmount ?? accountsPayable.originalAmount
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
    period: landingPeriod,
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
    lines: await provisionJournalLines(request, { voucherType: accountsPayable?.voucher?.voucherType, igvDeductible: accountsPayable?.accountingTreatment?.igvDeductible }),
    userId,
    session
  });
}

// Splits `amount` across request lines by `weight`, the last line taking the remainder.
function allocateAcrossLines(requestLines, amount, weight) {
  const weights = requestLines.map((line) => Number(weight(line) || 0));
  const basis = weights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return requestLines.map((line, index) => {
    const isLast = index === requestLines.length - 1;
    const share = basis > 0 ? weights[index] / basis : 1 / Math.max(1, requestLines.length);
    const value = isLast ? subtractMoney(amount, allocated) : roundMoney(amount * share);
    allocated = addMoney(allocated, value);
    return value;
  });
}

async function provisionJournalLinesForVoucher(request, voucherAmount) {
  await request.populate("lines.expenseType");
  const total = roundMoney(voucherAmount.totalAmount);
  const igv = roundMoney(voucherAmount.igvAmount || 0);
  const net = roundMoney(voucherAmount.netAmount ?? subtractMoney(total, igv));
  assertDocumentTotals({ netAmount: net, igvAmount: igv, totalAmount: total });
  const exchangeRate = Number(voucherAmount.exchangeRate ?? request.exchangeRate ?? 1);
  const payable = await requireAccountingMapping("ACCOUNTS_PAYABLE", request);
  const requestLines = request.lines || [];
  const requestNetTotal = sumMoney(requestLines.map((line) => line.netAmount));
  const requestIgvTotal = sumMoney(requestLines.map((line) => line.igvAmount));
  const netShares = allocateAcrossLines(requestLines, net, (line) => (requestNetTotal > 0 ? line.netAmount : line.totalAmount));
  const igvShares = allocateAcrossLines(requestLines, igv, (line) => (requestIgvTotal > 0 ? line.igvAmount : requestNetTotal > 0 ? line.netAmount : line.totalAmount));
  const lines = [];
  const expenseLines = [];
  let recoverableIgv = 0;
  let igvAnchor;
  for (const [index, line] of requestLines.entries()) {
    requireLineAccount(request, line);
    const recoverable = igvIsRecoverable(voucherAmount.voucherType, voucherAmount.igvDeductible);
    const igvToCost = recoverable ? 0 : igvShares[index];
    if (recoverable && igvShares[index] > 0) {
      recoverableIgv = addMoney(recoverableIgv, igvShares[index]);
      igvAnchor ||= line;
    }
    const pen = multiplyMoney(addMoney(netShares[index], igvToCost), exchangeRate);
    if (pen > 0) {
      const expense = debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: expenseDescription(voucherAmount.description || "Invoice provision", request.requestNumber, line.expenseType, igvToCost),
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: pen
      });
      lines.push(expense);
      expenseLines.push(expense);
    }
  }
  if (recoverableIgv > 0) {
    const igvMapping = await requireAccountingMapping("IGV", request);
    lines.push(debitLine({
      accountNumber: igvMapping.accountNumber,
      subAccount: igvMapping.subAccount,
      description: `Recoverable IGV ${request.requestNumber}`,
      costCenter: igvAnchor?.costCenter,
      expenseType: igvAnchor?.expenseType?._id,
      amount: multiplyMoney(recoverableIgv, exchangeRate)
    }));
  }
  const penTotal = multiplyMoney(total, exchangeRate);
  settleResidual(lines, penTotal, expenseLines);
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
      : await provisionJournalLinesForVoucher(request, { ...voucherAmount, voucherType: voucherAmount.voucherType || accountsPayable?.voucher?.voucherType, igvDeductible: voucherAmount.igvDeductible ?? accountsPayable?.accountingTreatment?.igvDeductible, exchangeRate }),
    userId,
    originalAmount: totalAmount,
    exchangeRate,
    penEquivalent: multiplyMoney(totalAmount, exchangeRate),
    session
  });
}

// One journal per confirmed bank operation (an installment of a partial payment, or the SPOT
// detraccion deposit), never the whole CXP: debit AP / credit bank for exactly the confirmed
// amount, keyed on the CXP id + the real operation number so a retry is idempotent and two
// installments never collide. The period is the actual payment date's month.
// USD: AP is relieved at the CXP rate. When EXCHANGE_GAIN and EXCHANGE_LOSS mappings exist the
// bank is credited at the payment-date SUNAT rate and the difference is posted; otherwise the
// bank is also credited at the CXP rate and the line description says so.
export async function createPaymentJournal(request, accountsPayable, userId, { bank, paymentDate, amount, amountPen, operationNumber, kind = "PAYMENT", session } = {}) {
  const currency = accountsPayable?.currency || request.currency;
  const detraction = kind === "DETRACTION";
  const [payable, bankMapping] = await Promise.all([
    requireAccountingMapping("ACCOUNTS_PAYABLE", request),
    // A detraccion is always deposited in soles at Banco de la Nacion from UMA's PEN account.
    requireAccountingMapping("BANK", request, { bank, currency: detraction ? "PEN" : currency })
  ]);
  const sourceAmount = roundMoney(amount ?? accountsPayable?.originalAmount ?? request.totalAmount);
  const cxpRate = Number(accountsPayable?.exchangeRate ?? request.exchangeRate ?? 1);
  const reference = String(operationNumber || request.requestNumber).trim();
  let apPen = roundMoney(detraction && amountPen !== undefined ? amountPen : multiplyMoney(sourceAmount, cxpRate));
  let bankPen = apPen;
  let rate = cxpRate;
  let rateNote = "";
  let gainMapping = null;
  let lossMapping = null;
  if (!detraction && currency !== "PEN" && paymentDate) {
    [gainMapping, lossMapping] = await Promise.all([
      resolveAccountingMapping("EXCHANGE_GAIN", request),
      resolveAccountingMapping("EXCHANGE_LOSS", request)
    ]);
    if (gainMapping && lossMapping) {
      rate = Number((await resolveExchangeRateSnapshot(currency, paymentDate)).rate);
      bankPen = roundMoney(multiplyMoney(sourceAmount, rate));
    } else {
      rateNote = " at CXP rate (no exchange-difference mapping)";
    }
  }
  const label = detraction ? `SPOT detraccion deposit ${reference}` : `Bank payment ${reference}`;
  const lines = [
    debitLine({ accountNumber: payable.accountNumber, subAccount: payable.subAccount, description: `Settle CXP ${request.requestNumber}`, amount: apPen }),
    creditLine({ accountNumber: bankMapping.accountNumber, subAccount: bankMapping.subAccount, description: `${label} ${request.requestNumber}${rateNote}`, amount: bankPen })
  ];
  const difference = subtractMoney(bankPen, apPen);
  if (difference > 0) lines.push(debitLine({ accountNumber: lossMapping.accountNumber, subAccount: lossMapping.subAccount, description: `Exchange loss ${request.requestNumber}`, amount: difference }));
  if (difference < 0) lines.push(creditLine({ accountNumber: gainMapping.accountNumber, subAccount: gainMapping.subAccount, description: `Exchange gain ${request.requestNumber}`, amount: -difference }));
  return createJournal({
    request,
    accountsPayable,
    entryType: "PAYMENT",
    period: paymentDate ? new Date(paymentDate).toISOString().slice(0, 7) : undefined,
    sourceTransaction: `${detraction ? "DETRACTION" : "PAYMENT"}:${accountsPayable?._id || request.requestNumber}:${reference}`,
    lines,
    userId,
    originalAmount: detraction ? apPen : sourceAmount,
    currency: detraction ? "PEN" : currency,
    exchangeRate: detraction ? 1 : rate,
    penEquivalent: bankPen,
    session
  });
}

function sunatValidationSnapshot(evidence) {
  if (!evidence) return undefined;
  if (hasManualSunatException(evidence)) {
    return {
      status: "MANUAL_EXCEPTION",
      manualException: {
        reason: evidence.manualOverride.reason,
        evidenceReference: evidence.manualOverride.evidenceReference,
        approvedBy: evidence.manualOverride.overriddenBy,
        approvedAt: evidence.manualOverride.overriddenAt
      }
    };
  }
  return { status: "VALID" };
}

// A payable holds its voucher identity until it is cancelled (voucherActive false). A payable fully
// offset by a credit note keeps the identity: that invoice exists and must not be registered twice.
function activePayableFilter({ supplierIdentifier, voucherType, series, number }) {
  return {
    supplierIdentifierSnapshot: normalizeToken(supplierIdentifier),
    "voucher.voucherType": { $in: voucherTypeVariants(voucherType) },
    "voucher.series": canonicalSeries(series),
    "voucher.number": voucherNumberPattern(number),
    voucherActive: { $ne: false }
  };
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
  accountingTreatment,
  session
}) {
  await assertPostingAllowed(request, { user });
  const supplierId = supplier?._id || supplier || request.supplier?._id || request.supplier;
  const supplierIdentifier = voucher.ruc || supplier?.normalizedIdentifier || supplier?.rucDni || request.supplierSnapshot?.identifier || request.rendition?.beneficiarySnapshot?.employeeCode || request.requester?.email || request.requestNumber;
  const identity = voucherIdentity({ ...voucher, ruc: voucher.ruc || supplierIdentifier, invoiceNumber: voucher.invoiceNumber });
  const { series, number } = identity;
  const voucherType = canonicalVoucherType(voucher.voucherType || voucher.documentType || "FACTURA");
  if (isAdjustmentNote(voucherType)) {
    throw new AppError(422, "Credit and debit notes adjust their original invoice; register them with the credit/debit note action instead of as a new payable.", { voucherType }, ERROR_CODES.VALIDATION_ERROR);
  }
  // Invoices land in the period of their own date. Track C advances are internal documents whose
  // period stays the request's fiscal period (see renditionService).
  const postingPeriod = request.flowType === FLOW_TYPE.C
    ? (request.fiscalData?.fiscalPeriod || request.accountingPeriod)
    : invoicePostingPeriod(voucher.issueDate || voucher.documentDate);
  const existing = await AccountsPayable.findOne(activePayableFilter({ supplierIdentifier, voucherType, series, number })).session(session || null);
  if (existing) {
    const sameRequest = String(existing.request) === String(request._id);
    const samePurchaseOrder = !purchaseOrder || String(existing.purchaseOrder || "") === String(purchaseOrder?._id || purchaseOrder);
    const sameBatch = !sourceBatch || String(existing.sourceBatch || "") === String(sourceBatch?._id || sourceBatch);
    const sameVoucher = !sunatVoucher || String(existing.sunatVoucher || "") === String(sunatVoucher?._id || sunatVoucher);
    if (sameRequest && samePurchaseOrder && sameBatch && sameVoucher) return existing;
    throw new AppError(409, "The fiscal voucher is already registered in Accounts Payable.", { accountsPayable: existing._id, request: existing.request }, ERROR_CODES.DUPLICATE_VOUCHER);
  }
  await guardAccountingPeriod({ period: postingPeriod, action: "POST", user, module: "ACCOUNTING", entityType: "AccountsPayable", requestId: request._id });
  let validatedVoucher;
  const total = roundMoney(voucher.totalAmount);
  if (request.flowType !== FLOW_TYPE.C) assertDocumentTotals({ netAmount: voucher.netAmount ?? subtractMoney(total, voucher.igvAmount || 0), igvAmount: voucher.igvAmount, totalAmount: total });
  // The payable and its provision always use the SUNAT selling rate of the invoice date.
  const rateEvidence = request.flowType === FLOW_TYPE.C ? request.exchangeRateEvidence : await resolveExchangeRateSnapshot(voucher.currency || request.currency, voucher.issueDate || voucher.documentDate || request.issueDate);
  const exchangeRate = Number(rateEvidence?.rate || request.exchangeRate || 1);
  await assertBudgetBeforePosting(request, { session, userId: user?._id || user, amount: multiplyMoney(total, exchangeRate), allowFxTopUp: (voucher.currency || request.currency) === "USD", exchangeRateEvidence: rateEvidence });
  if (request.flowType !== FLOW_TYPE.C) {
    const evidence = await SunatVoucher.findById(sunatVoucher?._id || sunatVoucher).select("+xmlPath +pdfPath").session(session || null);
    await assertVoucherEvidenceMatches(evidence?.xmlPath || evidence?.pdfPath, voucher);
    const fiscalValidation = hasManualSunatException(evidence)
      ? manualExceptionEvidence(evidence)
      : await validateVoucherWithSunat(voucher, { request, user });
    if (!fiscalValidation.valid) throw new AppError(422, fiscalValidation.detail, { validation: fiscalValidation }, ERROR_CODES.XML_VALIDATION_FAILED);
    validatedVoucher = evidence;
    evidence.validationEvidence = fiscalValidation;
    await evidence.save({ session });
    request.fiscalValidation = fiscalValidation;
  }
  const paymentTermsSnapshot = await resolvePayablePaymentTerms({ request, supplier, purchaseOrder, session });
  const penEquivalent = multiplyMoney(total, exchangeRate);
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
    invoiceAmount: total,
    invoicePenEquivalent: penEquivalent,
    accountingPeriod: postingPeriod,
    currency: voucher.currency || request.currency,
    exchangeRate,
    exchangeRateEvidence: rateEvidence,
    penEquivalent,
    outstandingAmount: total,
    sunatValidation: sunatValidationSnapshot(validatedVoucher),
    dueDate: resolvePayableDueDate({
      dueDate,
      voucher,
      paymentTermsSnapshot,
      flowType: flowType || request.flowType
    }),
    paymentTermsSnapshot,
    paymentPriority,
    accountingTreatment,
    status: AP_STATUS.OPEN,
    history: [{ status: AP_STATUS.OPEN, by: user?._id || user, comments: hasManualSunatException(validatedVoucher) ? "CXP created under an approved manual SUNAT exception." : "CXP created after automated fiscal validation." }]
  }], session ? { session } : undefined);
  const journal = await createProvisionJournalForVoucher(request, accountsPayable, {
    netAmount: voucher.netAmount,
    igvAmount: voucher.igvAmount,
    totalAmount: total,
    exchangeRate,
    voucherType,
    igvDeductible: accountingTreatment?.igvDeductible
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
  const recoverableIgv = deductibleLines.reduce((sum, line) => (igvIsRecoverable(undefined) ? addMoney(sum, line.igvAmount) : sum), 0);
  const [transit, igvMapping, returnedMapping] = await Promise.all([
    requireAccountingMapping("ADVANCE_TRANSIT", request),
    Number(recoverableIgv) > 0 ? requireAccountingMapping("IGV", request) : Promise.resolve(null),
    request.rendition.amountReturned > 0 ? requireAccountingMapping("RETURN_RECEIVABLE", request) : Promise.resolve(null)
  ]);
  const lines = [];
  const expenseLines = [];
  for (const line of deductibleLines) {
    const netPen = multiplyMoney(line.netAmount, request.exchangeRate);
    const igvPen = multiplyMoney(line.igvAmount, request.exchangeRate);
    const igvToCost = igvIsRecoverable(undefined) ? 0 : igvPen;
    requireLineAccount(request, line);
    if (addMoney(netPen, igvToCost) > 0) {
      const expense = debitLine({
        accountNumber: line.expenseType.accountNumber,
        subAccount: line.subAccount || "",
        description: expenseDescription("Rendition expense", request.requestNumber, line.expenseType, igvToCost),
        costCenter: line.costCenter,
        expenseType: line.expenseType._id,
        amount: addMoney(netPen, igvToCost)
      });
      lines.push(expense);
      expenseLines.push(expense);
    }
    if (igvPen > 0 && !igvToCost) {
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
  settleResidual(lines, clearedPen, expenseLines);
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

/**
 * Journal for a credit or debit note on an existing CXP. The note is valued at the original CXP's
 * exchange rate so the payable (and any supplier credit) stays consistent in PEN.
 * - DEBIT_NOTE: Dr expense/asset (+ recoverable IGV) / Cr Accounts Payable.
 * - CREDIT_NOTE: Dr Accounts Payable (the part that reduces the unpaid balance) and Dr Supplier
 *   credit receivable (the part already paid) / Cr expense/asset (+ recoverable IGV).
 */
export async function createAdjustmentNoteJournal(request, accountsPayable, { kind, noteVoucher, netAmount, igvAmount, totalAmount, supplierCreditAmount = 0, originalVoucherType, period, allowClosedRequest = false }, userId, { session } = {}) {
  const exchangeRate = Number(accountsPayable.exchangeRate || 1);
  const lines = await provisionJournalLinesForVoucher(request, {
    netAmount,
    igvAmount,
    totalAmount,
    exchangeRate,
    voucherType: originalVoucherType || accountsPayable.voucher?.voucherType,
    description: kind === "CREDIT_NOTE" ? "Credit note" : "Debit note"
  });
  const penTotal = multiplyMoney(totalAmount, exchangeRate);
  let journalLines = lines;
  if (kind === "CREDIT_NOTE") {
    const [payable, supplierCredit] = await Promise.all([
      requireAccountingMapping("ACCOUNTS_PAYABLE", request),
      supplierCreditAmount > 0 ? requireAccountingMapping("SUPPLIER_CREDIT", request) : Promise.resolve(null)
    ]);
    const supplierCreditPen = supplierCreditAmount > 0 ? multiplyMoney(supplierCreditAmount, exchangeRate) : 0;
    const payablePen = subtractMoney(penTotal, supplierCreditPen);
    journalLines = [
      ...(payablePen > 0 ? [debitLine({ accountNumber: payable.accountNumber, subAccount: payable.subAccount, description: `Credit note ${noteVoucher.seriesNumber} reduces CXP ${request.requestNumber}`, amount: payablePen })] : []),
      ...(supplierCreditPen > 0 ? [debitLine({ accountNumber: supplierCredit.accountNumber, subAccount: supplierCredit.subAccount, description: `Supplier credit from ${noteVoucher.seriesNumber} (${request.requestNumber})`, amount: supplierCreditPen })] : []),
      ...lines.filter((line) => line.debit > 0).map((line) => creditLine({
        accountNumber: line.accountNumber,
        subAccount: line.subAccount,
        description: `Credit note ${noteVoucher.seriesNumber}: ${line.description}`,
        costCenter: line.costCenter,
        expenseType: line.expenseType,
        amount: line.debit
      }))
    ];
  } else {
    journalLines = lines.map((line) => (line.credit > 0 ? { ...line, description: `Debit note ${noteVoucher.seriesNumber}: accounts payable ${request.requestNumber}` } : line));
  }
  return createJournal({
    request,
    accountsPayable,
    entryType: kind,
    period,
    sourceTransaction: `${kind}:${noteVoucher._id}`,
    lines: journalLines,
    userId,
    originalAmount: totalAmount,
    currency: accountsPayable.currency,
    exchangeRate,
    penEquivalent: penTotal,
    allowClosedRequest,
    session
  });
}

// Moves a supplier credit (receivable) onto an unpaid CXP of the same supplier (application) or
// records the supplier's refund into the bank (recovery).
export async function createSupplierCreditJournal(request, { kind, supplierCredit, accountsPayable, amount, bank, period }, userId, { session } = {}) {
  const penAmount = multiplyMoney(amount, supplierCredit.exchangeRate);
  const receivable = await requireAccountingMapping("SUPPLIER_CREDIT", request);
  const counterpart = kind === "SUPPLIER_CREDIT_APPLICATION"
    ? await requireAccountingMapping("ACCOUNTS_PAYABLE", request)
    : await requireAccountingMapping("BANK", request, { bank, currency: supplierCredit.currency });
  return createJournal({
    request,
    accountsPayable,
    entryType: kind,
    period,
    sourceTransaction: `${kind}:${supplierCredit._id}:${supplierCredit.movements.length}`,
    lines: [
      debitLine({
        accountNumber: counterpart.accountNumber,
        subAccount: counterpart.subAccount,
        description: kind === "SUPPLIER_CREDIT_APPLICATION" ? `Supplier credit ${supplierCredit.creditNoteSeriesNumber} applied to CXP ${request.requestNumber}` : `Supplier refund of credit ${supplierCredit.creditNoteSeriesNumber}`,
        amount: penAmount
      }),
      creditLine({
        accountNumber: receivable.accountNumber,
        subAccount: receivable.subAccount,
        description: `Clear supplier credit ${supplierCredit.creditNoteSeriesNumber}`,
        amount: penAmount
      })
    ],
    userId,
    originalAmount: amount,
    currency: supplierCredit.currency,
    exchangeRate: supplierCredit.exchangeRate,
    penEquivalent: penAmount,
    allowClosedRequest: kind === "SUPPLIER_CREDIT_RECOVERY",
    session
  });
}

async function recordObservedManualEvidence({ request, voucher, validation, invoiceFile, user, existing }) {
  if (existing?.accountsPayable) return existing;
  if (existing) {
    if (["PENDING", "OBSERVED_SUNAT"].includes(existing.validationStatus)) {
      existing.validationStatus = "OBSERVED_SUNAT";
      existing.observationDetail = validation.detail;
      existing.validationEvidence = validation;
      await existing.save();
    }
    return existing;
  }
  const xml = invoiceFile?.kind === "XML";
  return createSunatVoucher({ request, supplier: request.supplier, voucher, validationStatus: "OBSERVED_SUNAT", observationDetail: validation.detail, sunatResult: validation, xmlFile: xml ? invoiceFile : undefined, pdfFile: xml ? undefined : invoiceFile, user });
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
  if (isAdjustmentNote(fiscal.voucherType)) {
    throw new AppError(422, "A credit or debit note is not a new payable. Register it against its original invoice from Accounts Payable.", { voucherType: fiscal.voucherType }, ERROR_CODES.VALIDATION_ERROR);
  }
  // The invoice lands in its document date's period; the request's creation month is irrelevant.
  await guardAccountingPeriod({ period: fiscal.fiscalPeriod, action: "ACCOUNT", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  await request.populate("lines.expenseType");
  // Accounting sets the account (replacing the platform suggestion) and confirms SPOT / IGV here.
  await applyAccountingAccounts(request, payload);
  const treatment = accountingTreatmentPayload(payload, user);
  assertPostingAccount(request, fiscal.accountNumber);
  const duplicate = await AccountsPayable.findOne({
    request: { $ne: request._id },
    ...activePayableFilter({ supplierIdentifier: fiscal.supplierIdentifierNormalized, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number })
  });
  if (duplicate) {
    throw new AppError(409, "The supplier voucher is already registered.", { accountsPayable: duplicate._id }, ERROR_CODES.DUPLICATE_VOUCHER);
  }
  const purchaseOrder = request.flowType === FLOW_TYPE.A1 ? await PurchaseOrder.findOne({ request: request._id }) : null;
  const existingPayable = await AccountsPayable.findOne({ request: request._id,
    ...activePayableFilter({ supplierIdentifier: fiscal.supplierIdentifierNormalized, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number }) });
  if (existingPayable) throw new AppError(409, "This invoice already has an Accounts Payable record. Open the existing payable; do not provision it again.", { accountsPayable: existingPayable._id }, ERROR_CODES.DUPLICATE_VOUCHER);
  if (request.flowType === FLOW_TYPE.A1 && (purchaseOrder || requiresPurchaseOrder(request))) {
    if (!purchaseOrder) throw new AppError(409, "Procurement must issue the approved order before A1 accounting.");
    await assertPurchaseOrderInvoiceFits(purchaseOrder._id, request.totalAmount, { currency: request.currency });
  }
  await applyExchangeRate(request);
  // Supplier invoices use the SUNAT rate of the invoice date, not the rate frozen at request/budget time.
  const invoiceBased = request.flowType !== FLOW_TYPE.C;
  const rateEvidence = invoiceBased ? await resolveExchangeRateSnapshot(request.currency, fiscal.documentDate) : request.exchangeRateEvidence;
  const exchangeRate = Number(rateEvidence?.rate || request.exchangeRate || 1);
  const penTotal = invoiceBased ? multiplyMoney(request.totalAmount, exchangeRate) : roundMoney(request.totalPENEquivalent ?? request.penEquivalent);
  await assertBudgetBeforePosting(request, { userId: user._id, amount: penTotal, allowFxTopUp: invoiceBased && request.currency === "USD", exchangeRateEvidence: rateEvidence });
  let manualEvidence;
  if (invoiceBased) {
    const invoiceFile = latestInvoiceEvidence(request.attachments);
    const voucher = { ruc: supplierIdentifier, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number, issueDate: fiscal.documentDate, currency: request.currency, netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount };
    await assertVoucherEvidenceMatches(invoiceFile?.path, voucher);
    const existingEvidence = await findDuplicateVoucher(voucher);
    if (existingEvidence && String(existingEvidence.request) !== String(request._id)) throw new AppError(409, "Fiscal document already registered.", undefined, ERROR_CODES.DUPLICATE_VOUCHER);
    let validation;
    if (hasManualSunatException(existingEvidence)) {
      manualEvidence = existingEvidence;
      validation = manualExceptionEvidence(existingEvidence);
    } else {
      try {
        validation = await validateVoucherWithSunat(voucher, { request, user });
      } catch (error) {
        validation = { valid: false, status: error.code || "SUNAT_UNAVAILABLE", detail: error.message };
      }
      if (!validation.valid) {
        // Keep the observed evidence so Accounting can approve a manual SUNAT exception and retry.
        const observed = await recordObservedManualEvidence({ request, voucher, validation, invoiceFile, user, existing: existingEvidence });
        throw new AppError(422, validation.detail, { validation, sunatVoucher: observed?._id, manualExceptionAvailable: Boolean(observed) }, ERROR_CODES.XML_VALIDATION_FAILED);
      }
    }
    request.fiscalValidation = validation;
  }
  await validateAccountingDimensions({ requestType: request.requestType, expenseNature: request.expenseNature, lines: request.lines, requireAccount: true });
  await assertConfiguredDocuments(request, DOCUMENT_PHASE.ACCOUNTING);
  if (MANDATORY_XML_TYPES.includes(request.requestType) && !request.xmlValidation?.validated) {
    throw new AppError(422, "A verified invoice (its XML or factura PDF) is required before Accounting processing.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
  }

  const paymentTermsSnapshot = await resolvePayablePaymentTerms({ request, supplier: request.supplier });

  const result = await runFinancialOperation(async (session) => {
    request.fiscalData = {
      ...fiscal,
      igvDeductible: treatment?.igvDeductible,
      spotConfirmed: treatment?.spotConfirmed || undefined,
      spotCategoryCode: treatment?.spotConfirmed ? treatment.spotCategoryCode : undefined,
      processedAt: new Date(),
      processedBy: user._id
    };
    // A cancelled CXP never counts as the existing payable of the request.
    let accountsPayable = await AccountsPayable.findOne({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } }).session(session || null);
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
        invoiceAmount: request.totalAmount,
        invoicePenEquivalent: penTotal,
        accountingPeriod: fiscal.fiscalPeriod,
        currency: request.currency,
        exchangeRate,
        exchangeRateEvidence: rateEvidence,
        penEquivalent: penTotal,
        outstandingAmount: request.totalAmount,
        sunatValidation: invoiceBased ? (sunatValidationSnapshot(manualEvidence) || { status: "VALID" }) : undefined,
        dueDate: resolvePayableDueDate({ dueDate: payload.dueDate, voucher: fiscal, paymentTermsSnapshot, flowType: request.flowType }),
        paymentTermsSnapshot,
        accountingTreatment: treatment,
        status: AP_STATUS.OPEN,
        history: [{ status: AP_STATUS.OPEN, by: user._id, comments: manualEvidence ? "CXP created under an approved manual SUNAT exception." : "CXP created after fiscal validation." }]
      }], session ? { session } : undefined);
      if (purchaseOrder) await consumePurchaseOrderBalance(purchaseOrder._id, request.totalAmount, { session });
    } else if (treatment) accountsPayable.accountingTreatment = treatment;
    if (invoiceBased) {
      const voucher = { ruc: supplierIdentifier, voucherType: fiscal.voucherType, series: fiscal.series, number: fiscal.number, issueDate: fiscal.documentDate, currency: request.currency, netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount };
      let evidence = await findDuplicateVoucher(voucher, { session });
      if (evidence && String(evidence.request) !== String(request._id)) throw new AppError(409, "Fiscal document already registered.", undefined, ERROR_CODES.DUPLICATE_VOUCHER);
      if (!evidence) evidence = await createSunatVoucher({ request, supplier: request.supplier, voucher, validationStatus: "VALID", sunatResult: request.fiscalValidation, xmlFile: [...request.attachments].reverse().find(item => item.kind === "XML"), user, session });
      evidence.accountsPayable = accountsPayable._id;
      evidence.provisionedAt = new Date();
      evidence.validationEvidence = request.fiscalValidation;
      if (!hasManualSunatException(evidence)) evidence.validationStatus = "VALID";
      await evidence.save({ session });
      accountsPayable.sunatVoucher = evidence._id;
    }
    const journal = invoiceBased
      ? await createProvisionJournalForVoucher(request, accountsPayable, { netAmount: request.totalNet, igvAmount: request.totalIGV, totalAmount: request.totalAmount, exchangeRate, voucherType: fiscal.voucherType, igvDeductible: treatment?.igvDeductible }, user._id, { session })
      : await createProvisionJournal(request, accountsPayable, user._id, { session });
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
        accountingPeriod: accountsPayable.accountingPeriod,
        exchangeRate: accountsPayable.exchangeRate,
        sunatValidation: accountsPayable.sunatValidation?.status,
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
    title: notificationText("Payable item ready"),
    message: notificationText("{requestNumber} has an open CXP ready for Treasury scheduling.", { requestNumber: request.requestNumber }),
    path: `/treasury?tab=prepare&request=${request._id}`,
    entityType: "FinancialRequest",
    entityId: request._id
  });
  return result;
}

export async function generateProvisionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } });
  return [await createProvisionJournal(request, ap, userId, options)];
}

export async function generatePaymentEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } });
  return [await createPaymentJournal(request, ap, userId, options)];
}

export async function generateRenditionEntries(request, userId, options = {}) {
  const ap = await AccountsPayable.findOne({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } });
  return [await createRenditionJournal(request, ap, userId, options)];
}

export const applyCurrencyConversion = applyExchangeRate;

// Journal entry types that create (+) or remove (-) a payable, compared against the payables.
const PAYABLE_JOURNAL_SIGNS = Object.freeze({ PROVISION: 1, ADVANCE: 1, DEBIT_NOTE: 1, REVERSAL: -1, CREDIT_NOTE: -1 });
const CONSOLIDATION_ROW_TYPES = Object.freeze(["PROVISION", "ADVANCE", "RENDITION", "REVERSAL", "CREDIT_NOTE", "DEBIT_NOTE"]);

function payableBookedPen(ap) {
  if (ap.invoicePenEquivalent !== undefined && ap.invoicePenEquivalent !== null) return roundMoney(ap.invoicePenEquivalent);
  return roundMoney(ap.penEquivalent);
}

/**
 * Month-end consolidation. The source side is the Accounts Payable subledger for the period
 * (payables booked in it, cancellations and credit/debit notes dated in it); the centralization
 * side is the posted journals of the same period. A payable without its provision journal, a
 * journal without its payable, or a journal booked in another period shows up as a difference.
 */
export async function getConsolidation(period) {
  const [journalRows, journalTotals, periodPayables, periodProvisionJournals] = await Promise.all([
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: CONSOLIDATION_ROW_TYPES } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { costCenter: "$lines.costCenter", expenseType: "$lines.expenseType", accountNumber: "$lines.accountNumber" },
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" },
          requests: { $addToSet: "$request" }
        }
      }
    ]),
    JournalEntry.aggregate([
      { $match: { period, status: "POSTED", entryType: { $in: CONSOLIDATION_ROW_TYPES } } },
      { $group: { _id: "$entryType", total: { $sum: "$totalDebit" }, totalDebit: { $sum: "$totalDebit" }, totalCredit: { $sum: "$totalCredit" } } }
    ]),
    AccountsPayable.find({ $or: [{ accountingPeriod: period }, { "cancellation.period": period }, { "adjustments.period": period }] })
      .select("request accountingPeriod invoicePenEquivalent penEquivalent status provisionJournal cancellation adjustments")
      .populate("provisionJournal", "status period")
      .lean(),
    JournalEntry.find({ period, status: "POSTED", entryType: { $in: ["PROVISION", "ADVANCE"] }, accountsPayable: { $exists: true } }).select("accountsPayable").lean()
  ]);
  // Payables created before accountingPeriod existed are attributed to their provision's period.
  const knownIds = new Set(periodPayables.map((ap) => String(ap._id)));
  const legacyIds = periodProvisionJournals.map((journal) => journal.accountsPayable).filter((id) => id && !knownIds.has(String(id)));
  const legacyPayables = legacyIds.length
    ? await AccountsPayable.find({ _id: { $in: legacyIds }, accountingPeriod: { $exists: false } }).select("request invoicePenEquivalent penEquivalent status provisionJournal cancellation adjustments").populate("provisionJournal", "status period").lean()
    : [];

  let sourceTotal = 0;
  const requests = new Set();
  const unpostedPayables = [];
  for (const ap of periodPayables) {
    if (ap.accountingPeriod === period) {
      sourceTotal = addMoney(sourceTotal, payableBookedPen(ap));
      requests.add(String(ap.request));
      if (ap.provisionJournal?.status !== "POSTED" || ap.provisionJournal?.period !== period) unpostedPayables.push(ap._id);
    }
    if (ap.cancellation?.period === period) sourceTotal = subtractMoney(sourceTotal, roundMoney(ap.cancellation.penEquivalent ?? ap.penEquivalent));
    for (const adjustment of (ap.adjustments || []).filter((item) => item.period === period)) {
      sourceTotal = adjustment.kind === "DEBIT_NOTE" ? addMoney(sourceTotal, adjustment.penEquivalent) : subtractMoney(sourceTotal, adjustment.penEquivalent);
      requests.add(String(ap.request));
    }
  }
  for (const ap of legacyPayables) {
    sourceTotal = addMoney(sourceTotal, payableBookedPen(ap));
    requests.add(String(ap.request));
  }

  const rows = journalRows.map((row) => ({
    period,
    costCenter: row._id.costCenter,
    expenseType: row._id.expenseType,
    accountNumber: row._id.accountNumber || "",
    currency: "PEN",
    netAmount: subtractMoney(row.debit, row.credit),
    igvAmount: 0,
    totalAmount: subtractMoney(row.debit, row.credit),
    penEquivalent: subtractMoney(row.debit, row.credit),
    requestCount: row.requests.length,
    debit: roundMoney(row.debit),
    credit: roundMoney(row.credit)
  }));
  const centralizationTotal = journalTotals.reduce((sum, row) => {
    const sign = PAYABLE_JOURNAL_SIGNS[row._id] || 0;
    return sign > 0 ? addMoney(sum, row.total) : sign < 0 ? subtractMoney(sum, row.total) : sum;
  }, 0);
  const totalDebit = roundMoney(journalTotals.reduce((sum, row) => addMoney(sum, row.totalDebit), 0));
  const totalCredit = roundMoney(journalTotals.reduce((sum, row) => addMoney(sum, row.totalCredit), 0));
  const transactionSourceTotal = roundMoney(sourceTotal);
  return {
    rows,
    summary: {
      transactionSourceTotal,
      centralizationTotal: roundMoney(centralizationTotal),
      totalDebit,
      totalCredit,
      difference: subtractMoney(transactionSourceTotal, centralizationTotal),
      requestCount: requests.size,
      payableCount: periodPayables.filter((ap) => ap.accountingPeriod === period).length + legacyPayables.length,
      unpostedPayables,
      balanced: moneyEquals(totalDebit, totalCredit)
    }
  };
}

async function createAccountsPayableCancellationJournal(request, accountsPayable, userId, { session, period } = {}) {
  const original = await JournalEntry.findById(accountsPayable.provisionJournal).session(session || null);
  if (!original) return null;
  const reversedLines = original.lines.map((line) => ({
    accountNumber: line.accountNumber,
    subAccount: line.subAccount,
    description: `Reversal (CXP cancelled): ${line.description}`,
    costCenter: line.costCenter,
    expenseType: line.expenseType,
    debit: line.credit,
    credit: line.debit
  }));
  return createJournal({
    request,
    accountsPayable,
    entryType: "REVERSAL",
    period,
    sourceTransaction: `AP_CANCELLATION:${accountsPayable._id}`,
    lines: reversedLines,
    userId,
    originalAmount: original.originalAmount ?? accountsPayable.originalAmount,
    currency: accountsPayable.currency,
    exchangeRate: accountsPayable.exchangeRate,
    penEquivalent: original.totalDebit ?? accountsPayable.penEquivalent,
    session
  });
}

// An unpaid CXP (no payment file generated, no confirmed payment - nothing has left the bank)
// can be cancelled outright. The reversal is posted in the current open period, the budget it
// executed moves back to committed, the Purchase Order balance it consumed is restored, and its
// SUNAT voucher is marked ANNULLED so the same or a corrected invoice can be registered again.
// A partially paid or paid obligation cannot disappear this way - use a credit note. History is
// never deleted; cancellation only adds a reversing journal entry and history records.
export async function cancelAccountsPayable({ accountsPayableId, reason, user, req }) {
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) throw new AppError(422, "A cancellation reason is required.", { field: "reason" }, ERROR_CODES.VALIDATION_ERROR);
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  if (![AP_STATUS.OPEN, AP_STATUS.SCHEDULED].includes(accountsPayable.status)) {
    throw new AppError(
      409,
      "Only an unpaid CXP (no payment file generated or payment confirmed) can be cancelled. A partially paid or paid obligation requires a credit note, not cancellation.",
      { status: accountsPayable.status },
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }
  if (accountsPayable.adjustments?.length || accountsPayable.supplierCreditApplications?.length) {
    throw new AppError(409, "This CXP already has credit/debit notes or supplier credits applied. Register a credit note for the remaining balance instead of cancelling it.", { accountsPayableId }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (accountsPayable.detraction?.status === "DEPOSITED") {
    throw new AppError(409, "Money was already paid on this CXP (a transfer or the SPOT detraccion deposit). Register a credit note instead of cancelling it.", { accountsPayableId }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const request = await FinancialRequest.findById(accountsPayable.request);
  if (!request) throw new AppError(404, "Financial request not found.", { requestId: accountsPayable.request }, ERROR_CODES.NOT_FOUND);
  if ((request.payment?.confirmations || []).some((item) => String(item.accountsPayable || "") === String(accountsPayable._id))) {
    throw new AppError(409, "A payment was already confirmed on this CXP. Register a credit note instead of cancelling it.", { accountsPayableId }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const reversalPeriod = periodFromDate(new Date());
  await guardAccountingPeriod({ period: reversalPeriod, action: "POST", user, req, module: "ACCOUNTING", entityType: "AccountsPayable", entityId: accountsPayable._id, requestId: request._id });

  const result = await runFinancialOperation(async (session) => {
    const reversalJournal = await createAccountsPayableCancellationJournal(request, accountsPayable, user._id, { session, period: reversalPeriod });
    if (reversalJournal) await reverseBudgetExecution(request, user._id, accountsPayable.penEquivalent, { session, comments: `Accounts Payable ${accountsPayable._id} cancelled: ${trimmedReason}` });
    let purchaseOrder;
    if (accountsPayable.purchaseOrder) {
      purchaseOrder = await restorePurchaseOrderBalance(accountsPayable.purchaseOrder, accountsPayable.originalAmount, { session });
    }
    let voucher;
    if (accountsPayable.sunatVoucher) {
      voucher = await SunatVoucher.findById(accountsPayable.sunatVoucher).session(session || null);
      if (voucher) {
        const previousStatus = voucher.validationStatus;
        voucher.validationStatus = "ANNULLED";
        voucher.observationDetail = `CXP cancelled: ${trimmedReason}`;
        voucher.annulment = { reason: trimmedReason, accountsPayable: accountsPayable._id, at: new Date(), by: user._id };
        await voucher.save({ session });
        await recordAudit({ entityType: "SunatVoucher", entity: voucher, requestId: request._id, action: "VOUCHER_ANNULLED", user, req, module: "ACCOUNTING", comments: trimmedReason, oldValues: { validationStatus: previousStatus }, newValues: { validationStatus: "ANNULLED" }, session });
      }
    }
    const cancelledPen = reversalJournal?.totalDebit ?? accountsPayable.penEquivalent;
    accountsPayable.status = AP_STATUS.CANCELLED;
    accountsPayable.outstandingAmount = 0;
    accountsPayable.voucherActive = false;
    accountsPayable.cancellation = { reason: trimmedReason, period: reversalJournal ? reversalPeriod : undefined, penEquivalent: reversalJournal ? cancelledPen : 0, journal: reversalJournal?._id, at: new Date(), by: user._id };
    accountsPayable.history.push({ status: AP_STATUS.CANCELLED, by: user._id, comments: trimmedReason });
    await accountsPayable.save({ session });
    if (String(request.accountsPayable || "") === String(accountsPayable._id)) {
      const replacement = await AccountsPayable.findOne({ request: request._id, status: { $ne: AP_STATUS.CANCELLED } }).session(session || null);
      request.accountsPayable = replacement?._id;
    }
    // Re-derive the parent status: without any active payable the request returns to the budget
    // commitment stage, so a corrected invoice can be registered.
    const progress = await syncFinancialProgress({ request, user, req, session, action: "ACCOUNTS_PAYABLE_CANCELLED" });
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "ACCOUNTS_PAYABLE_CANCELLED",
      user,
      req,
      module: "ACCOUNTING",
      comments: trimmedReason,
      newValues: { status: AP_STATUS.CANCELLED, reversalJournal: reversalJournal?.entryNumber, reversalPeriod, purchaseOrderRemaining: purchaseOrder?.remainingAmount, voucherStatus: voucher?.validationStatus, requestStatus: request.status },
      session
    });
    return { accountsPayable, reversalJournal, request, purchaseOrder, voucher, progress };
  });
  await resolveNotification(`request:${result.request._id}:treasury:${result.accountsPayable._id}`);
  await resolveNotification(`request:${result.request._id}:payment-confirmation:${result.accountsPayable._id}`);
  return result;
}
