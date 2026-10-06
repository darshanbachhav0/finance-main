import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import SunatVoucher from "../models/SunatVoucher.js";
import SupplierCredit from "../models/SupplierCredit.js";
import { isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { createAdjustmentNoteJournal, createSupplierCreditJournal, invoicePostingPeriod } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { assertBudgetBeforePosting, executeBudgetAmount, reverseBudgetExecution } from "./budgetService.js";
import { syncFinancialProgress } from "./financialProgressService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { assertPurchaseOrderInvoiceFits, consumePurchaseOrderBalance, restorePurchaseOrderBalance } from "./purchaseOrderMatchingService.js";
import { escapedRegex, paginatedPayload, parsePagination } from "./queryService.js";
import { cleanupUploadedFiles, persistUploadedFiles } from "./storageService.js";
import {
  createSunatVoucher,
  findDuplicateVoucher,
  hasManualSunatException,
  splitVoucherNumber,
  validateVoucherWithSunat,
  voucherIdentity
} from "./sunatVoucherService.js";
import { runFinancialOperation } from "./transactionService.js";
import { assertVoucherEvidenceMatches, fileChecksum, parseInvoiceXml } from "./xmlValidationService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES, FLOW_TYPE } from "../utils/constants.js";
import { addMoney, moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";
import { canonicalVoucherType, isAdjustmentNote } from "../utils/voucherIdentity.js";

// A credit note can reduce the unpaid balance of a CXP in these states. Once the payment file is
// with the bank the amount can no longer change; once paid, the credit becomes a supplier credit.
const REDUCIBLE_STATUSES = new Set([AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PARTIALLY_PAID, AP_STATUS.PAYMENT_BOUNCED]);
const ADJUSTABLE_BY_DEBIT_NOTE = new Set([AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PARTIALLY_PAID, AP_STATUS.PAYMENT_BOUNCED, AP_STATUS.PAID]);

const noteKind = (voucherType) => (canonicalVoucherType(voucherType) === "NOTA_CREDITO" ? "CREDIT_NOTE" : "DEBIT_NOTE");

async function resolveOriginalVoucher({ note, originalVoucherId }) {
  const identity = voucherIdentity(note);
  let fromXml = null;
  if (note.reference?.seriesNumber) {
    fromXml = await findDuplicateVoucher({ ruc: identity.rucIssuer, voucherType: note.reference.voucherType || "FACTURA", invoiceNumber: note.reference.seriesNumber });
  }
  const chosen = originalVoucherId ? await SunatVoucher.findById(originalVoucherId) : null;
  if (originalVoucherId && !chosen) throw new AppError(404, "The selected original invoice was not found.", { originalVoucherId }, ERROR_CODES.NOT_FOUND);
  if (fromXml && chosen && String(fromXml._id) !== String(chosen._id)) {
    throw new AppError(422, `The note's XML references ${note.reference.seriesNumber}, not the invoice you selected.`, { reference: note.reference, selected: chosen.seriesNumber }, ERROR_CODES.VALIDATION_ERROR);
  }
  const original = fromXml || chosen;
  if (!original) {
    throw new AppError(
      422,
      note.reference?.seriesNumber
        ? `The invoice ${note.reference.seriesNumber} referenced by this note is not registered. Register it first or select the original invoice.`
        : "The note's XML does not reference its original invoice. Select the original invoice it modifies.",
      { reference: note.reference },
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  if (original.validationStatus === "ANNULLED") throw new AppError(409, "The original invoice was annulled with its cancelled CXP; a note cannot adjust it.", { original: original._id }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  if (isAdjustmentNote(original.voucherType)) throw new AppError(422, "A credit or debit note must reference an invoice, not another note.", { original: original._id }, ERROR_CODES.VALIDATION_ERROR);
  if (original.rucIssuer !== identity.rucIssuer) throw new AppError(422, "The note's issuer RUC does not match the original invoice's issuer.", { noteRuc: identity.rucIssuer, invoiceRuc: original.rucIssuer }, ERROR_CODES.XML_VALIDATION_FAILED);
  if (!original.accountsPayable) throw new AppError(409, "The original invoice has not been posted to Accounts Payable yet.", { original: original._id }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  return original;
}

function noteVoucherFromXml(data) {
  const parts = splitVoucherNumber(data.invoiceNumber);
  return {
    ruc: data.ruc,
    voucherType: data.voucherType,
    series: parts.series,
    number: parts.number,
    invoiceNumber: data.invoiceNumber,
    issueDate: data.issueDate,
    currency: data.currency,
    netAmount: data.netAmount,
    igvAmount: data.igvAmount ?? 0,
    totalAmount: data.totalAmount,
    reference: data.reference
  };
}

async function storeNoteVoucher({ request, accountsPayable, original, voucher, existing, status, detail, sunatResult, xmlFile, pdfFile, user }) {
  let stored = existing;
  if (!stored) {
    stored = await createSunatVoucher({
      request,
      purchaseOrder: accountsPayable.purchaseOrder,
      batch: accountsPayable.sourceBatch,
      supplier: original.supplier,
      voucher,
      flowType: accountsPayable.flowType || request.flowType,
      validationStatus: status,
      observationDetail: detail,
      sunatResult,
      xmlFile,
      pdfFile,
      user
    });
  } else {
    stored.set({ validationStatus: hasManualSunatException(stored) ? stored.validationStatus : status, observationDetail: detail, validationEvidence: sunatResult || stored.validationEvidence, xmlPath: xmlFile?.path || stored.xmlPath, xmlUrl: xmlFile?.url || stored.xmlUrl, xmlChecksum: xmlFile?.checksum || stored.xmlChecksum, pdfPath: pdfFile?.path || stored.pdfPath, pdfUrl: pdfFile?.url || stored.pdfUrl });
  }
  // A note belongs to its original CXP from the start, so it never counts as an unaccounted invoice.
  stored.referencedVoucher = original._id;
  stored.accountsPayable = accountsPayable._id;
  await stored.save();
  return stored;
}

/**
 * Registers a credit note (NOTA_CREDITO, Tabla 10 "07") or debit note ("08") from its XML. The note
 * is linked to its original voucher from the XML BillingReference, or to the invoice chosen by the
 * user when the XML has no reference. After SUNAT validation (or an approved manual exception) the
 * accounting effect is applied automatically; see applyAdjustmentNote.
 */
export async function registerAdjustmentNote({ xmlFile, pdfFile, files, originalVoucherId, requestId, user, req }) {
  let persisted;
  let adopted = false;
  try {
    if (!xmlFile && files) {
      persisted = await persistUploadedFiles(files, { domain: "requests", entityId: requestId || "adjustment-notes" });
      xmlFile = persisted.xml?.[0];
      pdfFile = persisted.pdf?.[0];
    }
    if (!xmlFile?.path) throw new AppError(422, "The credit/debit note XML is required.", { field: "xml" }, ERROR_CODES.XML_VALIDATION_FAILED);
    xmlFile.checksum ||= await fileChecksum(xmlFile.path);
    const data = await parseInvoiceXml(xmlFile.path);
    if (!isAdjustmentNote(data.voucherType)) {
      throw new AppError(422, "The XML is not a credit note (07) or debit note (08).", { documentTypeCode: data.documentTypeCode }, ERROR_CODES.VALIDATION_ERROR);
    }
    const voucher = noteVoucherFromXml(data);
    if (!(Number(voucher.totalAmount) > 0) || !voucher.series || !voucher.number || !voucher.ruc) {
      throw new AppError(422, "The note XML must include the issuer RUC, series, number and a positive total.", undefined, ERROR_CODES.XML_VALIDATION_FAILED);
    }
    const original = await resolveOriginalVoucher({ note: voucher, originalVoucherId });
    const accountsPayable = await AccountsPayable.findById(original.accountsPayable);
    if (!accountsPayable) throw new AppError(404, "The original invoice's CXP was not found.", undefined, ERROR_CODES.NOT_FOUND);
    if (requestId && String(accountsPayable.request) !== String(requestId)) {
      throw new AppError(422, "The note's original invoice belongs to a different request.", { request: accountsPayable.request }, ERROR_CODES.VALIDATION_ERROR);
    }
    if (voucher.currency && voucher.currency !== accountsPayable.currency) {
      throw new AppError(422, "The note currency does not match the original invoice.", { noteCurrency: voucher.currency, invoiceCurrency: accountsPayable.currency }, ERROR_CODES.VALIDATION_ERROR);
    }
    const request = await FinancialRequest.findById(accountsPayable.request).populate("supplier");
    const existing = await findDuplicateVoucher(voucher);
    if (existing && (existing.adjustmentAppliedAt || String(existing.referencedVoucher || "") !== String(original._id))) {
      throw new AppError(409, "This credit/debit note is already registered.", { voucher: existing._id }, ERROR_CODES.DUPLICATE_VOUCHER);
    }
    let sunatResult;
    let detail;
    if (!hasManualSunatException(existing)) {
      try {
        sunatResult = await validateVoucherWithSunat(voucher, { request, user });
      } catch (error) {
        sunatResult = { valid: false, status: error.code || "SUNAT_UNAVAILABLE", detail: error.message };
      }
      detail = sunatResult.valid ? "" : sunatResult.detail || "SUNAT validation failed.";
    }
    const stored = await storeNoteVoucher({ request, accountsPayable, original, voucher, existing, status: !sunatResult || sunatResult.valid ? "VALID" : "OBSERVED_SUNAT", detail, sunatResult, xmlFile, pdfFile, user });
    adopted = true;
    await recordAudit({ entityType: "SunatVoucher", entity: stored, requestId: request._id, action: `${noteKind(voucher.voucherType)}_REGISTERED`, user, req, module: "ACCOUNTING", newValues: { original: original.seriesNumber, amount: voucher.totalAmount, validationStatus: stored.validationStatus } });
    if (sunatResult && !sunatResult.valid) return { observed: true, sunatVoucher: stored, detail, original, accountsPayable };
    const applied = await applyAdjustmentNote({ noteVoucherId: stored._id, user, req });
    return { observed: false, ...applied, original };
  } catch (error) {
    if (persisted && !adopted) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}

/**
 * Applies a validated (or manually excepted) credit/debit note to its original CXP.
 * - Credit note, invoice unpaid: reduces the CXP amount and outstanding balance.
 * - Credit note, invoice (partly) paid: the unpaid part reduces the balance; the paid part becomes a
 *   SupplierCredit (receivable) to be recovered or applied to a future invoice of the supplier.
 * - Debit note: increases the original CXP (a paid CXP reopens as partially paid).
 * The journal posts in the note's own date period and always balances.
 */
export async function applyAdjustmentNote({ noteVoucherId, user, req }) {
  const note = await SunatVoucher.findById(noteVoucherId).select("+xmlPath");
  if (!note) throw new AppError(404, "Credit/debit note not found.", { noteVoucherId }, ERROR_CODES.NOT_FOUND);
  if (!isAdjustmentNote(note.voucherType)) throw new AppError(422, "The voucher is not a credit or debit note.", { voucherType: note.voucherType }, ERROR_CODES.VALIDATION_ERROR);
  if (note.adjustmentAppliedAt) {
    const accountsPayable = await AccountsPayable.findById(note.accountsPayable);
    return { note, accountsPayable, alreadyApplied: true };
  }
  if (note.validationStatus !== "VALID" && !hasManualSunatException(note)) {
    throw new AppError(422, "The note must pass SUNAT validation, or Accounting must approve a manual SUNAT exception, before it is applied.", { validationStatus: note.validationStatus }, ERROR_CODES.XML_VALIDATION_FAILED);
  }
  const original = await SunatVoucher.findById(note.referencedVoucher);
  if (!original) throw new AppError(422, "The note is not linked to its original invoice.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const accountsPayable = await AccountsPayable.findById(original.accountsPayable);
  if (!accountsPayable) throw new AppError(404, "The original invoice's CXP was not found.", undefined, ERROR_CODES.NOT_FOUND);
  const request = await FinancialRequest.findById(accountsPayable.request).populate("supplier");
  const kind = noteKind(note.voucherType);
  const total = roundMoney(note.xmlAmount);
  const igv = roundMoney(note.igvAmount || 0);
  const net = roundMoney(note.netAmount ?? subtractMoney(total, igv));
  const rate = Number(accountsPayable.exchangeRate || 1);
  if (note.xmlPath) {
    await assertVoucherEvidenceMatches(note.xmlPath, { ruc: note.rucIssuer, series: note.series, number: note.number, issueDate: note.issueDate, currency: note.currency || accountsPayable.currency, netAmount: note.netAmount, igvAmount: note.igvAmount, totalAmount: note.xmlAmount });
  }
  const period = invoicePostingPeriod(note.issueDate);
  await guardAccountingPeriod({ period, action: "POST", user, req, module: "ACCOUNTING", entityType: "AccountsPayable", entityId: accountsPayable._id, requestId: request._id });
  if (accountsPayable.status === AP_STATUS.CANCELLED) throw new AppError(409, "The original CXP is cancelled; the note cannot be applied to it.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  if (accountsPayable.status === AP_STATUS.PAYMENT_FILE_CREATED) throw new AppError(409, "A bank payment file is in progress for this CXP. Confirm or reject that payment before applying the note.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);

  const credits = sumMoney((accountsPayable.adjustments || []).filter((item) => item.kind === "CREDIT_NOTE").map((item) => item.amount));
  const debits = sumMoney((accountsPayable.adjustments || []).filter((item) => item.kind === "DEBIT_NOTE").map((item) => item.amount));
  const invoiceAmount = roundMoney(accountsPayable.invoiceAmount ?? accountsPayable.originalAmount);
  let payablePart = 0;
  let supplierPart = 0;
  if (kind === "CREDIT_NOTE") {
    const creditable = subtractMoney(addMoney(invoiceAmount, debits), credits);
    if (total > creditable && !moneyEquals(total, creditable)) {
      throw new AppError(422, "The credit note exceeds the invoice amount still creditable.", { creditNote: total, creditable }, ERROR_CODES.VALIDATION_ERROR);
    }
    payablePart = REDUCIBLE_STATUSES.has(accountsPayable.status) ? Math.min(total, roundMoney(accountsPayable.outstandingAmount)) : 0;
    supplierPart = subtractMoney(total, payablePart);
  } else {
    if (!ADJUSTABLE_BY_DEBIT_NOTE.has(accountsPayable.status)) throw new AppError(409, "The original CXP cannot receive a debit note in its current state.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    if (accountsPayable.purchaseOrder) await assertPurchaseOrderInvoiceFits(accountsPayable.purchaseOrder, total, { currency: accountsPayable.currency });
    if (accountsPayable.flowType !== FLOW_TYPE.C) await assertBudgetBeforePosting(request, { userId: user._id, amount: multiplyMoney(total, rate), allowFxTopUp: accountsPayable.currency === "USD" });
  }
  // A credit that only creates a supplier receivable may arrive after the request was closed.
  const allowClosedRequest = kind === "CREDIT_NOTE" && payablePart === 0 && isTerminalRequest(request.status);

  return runFinancialOperation(async (session) => {
    const journal = await createAdjustmentNoteJournal(request, accountsPayable, {
      kind, noteVoucher: note, netAmount: net, igvAmount: igv, totalAmount: total,
      supplierCreditAmount: supplierPart, originalVoucherType: original.voucherType, period, allowClosedRequest
    }, user._id, { session });
    const penTotal = roundMoney(journal.penEquivalent);
    const supplierPen = supplierPart > 0 ? multiplyMoney(supplierPart, rate) : 0;
    const payablePen = subtractMoney(penTotal, supplierPen);
    let supplierCredit;
    if (kind === "CREDIT_NOTE") {
      accountsPayable.originalAmount = Math.max(0, subtractMoney(accountsPayable.originalAmount, payablePart));
      accountsPayable.outstandingAmount = Math.max(0, subtractMoney(accountsPayable.outstandingAmount, payablePart));
      accountsPayable.penEquivalent = Math.max(0, subtractMoney(accountsPayable.penEquivalent, payablePen));
      if (payablePart > 0 && moneyEquals(accountsPayable.originalAmount, 0)) {
        // Fully offset before any payment: the obligation is extinguished, not paid.
        accountsPayable.status = AP_STATUS.CANCELLED;
        accountsPayable.history.push({ status: AP_STATUS.CANCELLED, by: user._id, comments: `Fully offset by credit note ${note.seriesNumber}.` });
      } else if (payablePart > 0 && moneyEquals(accountsPayable.outstandingAmount, 0) && accountsPayable.status === AP_STATUS.PARTIALLY_PAID) {
        accountsPayable.status = AP_STATUS.PAID;
        accountsPayable.paidDate ||= new Date();
        accountsPayable.history.push({ status: AP_STATUS.PAID, by: user._id, comments: `Remaining balance settled by credit note ${note.seriesNumber}.` });
      }
      if (supplierPart > 0) {
        [supplierCredit] = await SupplierCredit.create([{
          supplier: accountsPayable.supplier || original.supplier,
          supplierIdentifierSnapshot: accountsPayable.supplierIdentifierSnapshot,
          request: request._id,
          originalAccountsPayable: accountsPayable._id,
          originalVoucher: original._id,
          creditNoteVoucher: note._id,
          creditNoteSeriesNumber: note.seriesNumber,
          currency: accountsPayable.currency,
          exchangeRate: rate,
          amount: supplierPart,
          penEquivalent: supplierPen,
          remainingAmount: supplierPart,
          status: "OPEN",
          originJournal: journal._id,
          period,
          createdBy: user._id
        }], session ? { session } : undefined);
      }
      if (accountsPayable.flowType !== FLOW_TYPE.C) await reverseBudgetExecution(request, user._id, penTotal, { session, comments: `Credit note ${note.seriesNumber} on ${original.seriesNumber}.` });
      if (accountsPayable.purchaseOrder) await restorePurchaseOrderBalance(accountsPayable.purchaseOrder, total, { session });
    } else {
      if (accountsPayable.purchaseOrder) await consumePurchaseOrderBalance(accountsPayable.purchaseOrder, total, { session });
      accountsPayable.originalAmount = addMoney(accountsPayable.originalAmount, total);
      accountsPayable.outstandingAmount = addMoney(accountsPayable.outstandingAmount, total);
      accountsPayable.penEquivalent = addMoney(accountsPayable.penEquivalent, penTotal);
      if (accountsPayable.status === AP_STATUS.PAID) {
        accountsPayable.status = AP_STATUS.PARTIALLY_PAID;
        accountsPayable.history.push({ status: AP_STATUS.PARTIALLY_PAID, by: user._id, comments: `Debit note ${note.seriesNumber} reopened the CXP for ${total.toFixed(2)}.` });
      }
      if (accountsPayable.flowType !== FLOW_TYPE.C) await executeBudgetAmount(request, user._id, penTotal, { session, comments: `Debit note ${note.seriesNumber} on ${original.seriesNumber}.` });
    }
    accountsPayable.adjustments.push({
      kind,
      sunatVoucher: note._id,
      voucherType: note.voucherType,
      series: note.series,
      number: note.number,
      documentDate: note.issueDate,
      amount: total,
      appliedToPayable: kind === "CREDIT_NOTE" ? payablePart : total,
      supplierCreditAmount: supplierPart,
      supplierCredit: supplierCredit?._id,
      penEquivalent: penTotal,
      journal: journal._id,
      period,
      by: user._id
    });
    accountsPayable.history.push({ status: accountsPayable.status, by: user._id, comments: `${kind === "CREDIT_NOTE" ? "Credit" : "Debit"} note ${note.seriesNumber} applied (${total.toFixed(2)}${supplierPart > 0 ? `, ${supplierPart.toFixed(2)} as supplier credit` : ""}).` });
    await accountsPayable.save({ session });
    note.accountsPayable = accountsPayable._id;
    note.adjustmentAppliedAt = new Date();
    note.provisionedAt = new Date();
    await note.save({ session });
    if (!isTerminalRequest(request.status)) await syncFinancialProgress({ request, user, req, session, action: `${kind}_APPLIED` });
    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: `${kind}_APPLIED`,
      user,
      req,
      module: "ACCOUNTING",
      newValues: { note: note.seriesNumber, original: original.seriesNumber, amount: total, appliedToPayable: payablePart, supplierCredit: supplierPart, journal: journal.entryNumber, period, outstandingAmount: accountsPayable.outstandingAmount },
      session
    });
    return { note, accountsPayable, journal, supplierCredit, request };
  });
}

export async function listSupplierCredits(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.supplier) filter.supplier = query.supplier;
  if (query.search) filter.creditNoteSeriesNumber = new RegExp(escapedRegex(query.search), "i");
  const { page, pageSize, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    SupplierCredit.find(filter)
      .populate("supplier", "supplierCode legalName name rucDni")
      .populate("request", "requestNumber status")
      .populate("originalVoucher", "seriesNumber voucherType")
      .sort({ createdAt: -1 }).skip(skip).limit(pageSize),
    SupplierCredit.countDocuments(filter)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

function refreshCreditStatus(credit) {
  credit.status = moneyEquals(credit.remainingAmount, 0) ? "SETTLED" : moneyEquals(credit.remainingAmount, credit.amount) ? "OPEN" : "PARTIALLY_APPLIED";
}

async function loadOpenCredit(supplierCreditId, amount) {
  const credit = await SupplierCredit.findById(supplierCreditId);
  if (!credit) throw new AppError(404, "Supplier credit not found.", { supplierCreditId }, ERROR_CODES.NOT_FOUND);
  if (credit.status === "SETTLED") throw new AppError(409, "This supplier credit is already fully used.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const value = roundMoney(amount ?? credit.remainingAmount);
  if (!(value > 0)) throw new AppError(422, "A positive amount is required.", { amount }, ERROR_CODES.VALIDATION_ERROR);
  if (value > credit.remainingAmount && !moneyEquals(value, credit.remainingAmount)) throw new AppError(422, "The amount exceeds the remaining supplier credit.", { amount: value, remaining: credit.remainingAmount }, ERROR_CODES.VALIDATION_ERROR);
  return { credit, value };
}

// Applies a supplier credit to an unpaid CXP of the same supplier. It works like a non-cash
// payment: the CXP's outstanding balance falls and the settlement is recorded as a confirmation,
// so the request's payment progress stays derived from real evidence.
export async function applySupplierCredit({ supplierCreditId, accountsPayableId, amount, user, req }) {
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  const { credit, value: requested } = await loadOpenCredit(supplierCreditId, amount ?? undefined);
  if (String(accountsPayable.supplier || "") !== String(credit.supplier)) throw new AppError(422, "A supplier credit can only be applied to an invoice of the same supplier.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (accountsPayable.currency !== credit.currency) throw new AppError(422, "The supplier credit and the invoice must be in the same currency.", { creditCurrency: credit.currency, invoiceCurrency: accountsPayable.currency }, ERROR_CODES.VALIDATION_ERROR);
  if (!REDUCIBLE_STATUSES.has(accountsPayable.status)) throw new AppError(409, "The supplier credit can only be applied to an unpaid CXP that is not in a bank payment file.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const value = Math.min(requested, roundMoney(accountsPayable.outstandingAmount));
  if (!(value > 0)) throw new AppError(409, "The CXP has no outstanding balance.", undefined, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const request = await FinancialRequest.findById(accountsPayable.request);
  const period = periodFromDate(new Date());
  await guardAccountingPeriod({ period, action: "POST", user, req, module: "ACCOUNTING", entityType: "SupplierCredit", entityId: credit._id, requestId: request._id });
  return runFinancialOperation(async (session) => {
    const journal = await createSupplierCreditJournal(request, { kind: "SUPPLIER_CREDIT_APPLICATION", supplierCredit: credit, accountsPayable, amount: value, period }, user._id, { session });
    credit.movements.push({ kind: "APPLICATION", amount: value, penEquivalent: journal.penEquivalent, accountsPayable: accountsPayable._id, journal: journal._id, date: new Date(), by: user._id });
    credit.remainingAmount = subtractMoney(credit.remainingAmount, value);
    refreshCreditStatus(credit);
    await credit.save({ session });
    const reference = `SUPPLIER-CREDIT-${credit.creditNoteSeriesNumber}`;
    request.payment ||= {};
    request.payment.confirmations ||= [];
    request.payment.confirmations.push({ accountsPayable: accountsPayable._id, operationNumber: reference, paidAt: new Date(), amount: value, currency: accountsPayable.currency, confirmedAt: new Date(), confirmedBy: user._id, comments: `Compensated with supplier credit ${credit.creditNoteSeriesNumber}.` });
    accountsPayable.outstandingAmount = subtractMoney(accountsPayable.outstandingAmount, value);
    accountsPayable.supplierCreditApplications.push({ supplierCredit: credit._id, amount: value, journal: journal._id, by: user._id });
    if (moneyEquals(accountsPayable.outstandingAmount, 0)) {
      accountsPayable.status = AP_STATUS.PAID;
      accountsPayable.paidDate = new Date();
      accountsPayable.paymentJournal ||= journal._id;
    } else {
      accountsPayable.status = AP_STATUS.PARTIALLY_PAID;
    }
    accountsPayable.history.push({ status: accountsPayable.status, by: user._id, comments: `Supplier credit ${credit.creditNoteSeriesNumber} applied (${value.toFixed(2)}).` });
    await accountsPayable.save({ session });
    await syncFinancialProgress({ request, user, req, session, action: "SUPPLIER_CREDIT_APPLIED" });
    await recordAudit({ entityType: "SupplierCredit", entity: credit, requestId: request._id, action: "SUPPLIER_CREDIT_APPLIED", user, req, module: "ACCOUNTING", newValues: { accountsPayable: accountsPayable._id, amount: value, remaining: credit.remainingAmount, journal: journal.entryNumber }, session });
    return { supplierCredit: credit, accountsPayable, journal };
  });
}

// Records the supplier's refund of a credit into the bank.
export async function recoverSupplierCredit({ supplierCreditId, amount, bank, date, reference, user, req }) {
  const { credit, value } = await loadOpenCredit(supplierCreditId, amount ?? undefined);
  const referenceText = String(reference || "").trim();
  if (!referenceText) throw new AppError(422, "The bank operation reference of the refund is required.", { field: "reference" }, ERROR_CODES.VALIDATION_ERROR);
  if (!String(bank || "").trim()) throw new AppError(422, "The receiving bank is required.", { field: "bank" }, ERROR_CODES.VALIDATION_ERROR);
  const receivedAt = date ? new Date(date) : new Date();
  if (Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now()) throw new AppError(422, "A valid refund date that is not in the future is required.", { date }, ERROR_CODES.VALIDATION_ERROR);
  const request = await FinancialRequest.findById(credit.request);
  const accountsPayable = await AccountsPayable.findById(credit.originalAccountsPayable);
  const period = periodFromDate(receivedAt);
  await guardAccountingPeriod({ period, action: "POST", user, req, module: "ACCOUNTING", entityType: "SupplierCredit", entityId: credit._id, requestId: request._id });
  return runFinancialOperation(async (session) => {
    const journal = await createSupplierCreditJournal(request, { kind: "SUPPLIER_CREDIT_RECOVERY", supplierCredit: credit, accountsPayable, amount: value, bank: String(bank).trim().toUpperCase(), period }, user._id, { session });
    credit.movements.push({ kind: "RECOVERY", amount: value, penEquivalent: journal.penEquivalent, reference: referenceText, date: receivedAt, journal: journal._id, by: user._id });
    credit.remainingAmount = subtractMoney(credit.remainingAmount, value);
    refreshCreditStatus(credit);
    await credit.save({ session });
    await recordAudit({ entityType: "SupplierCredit", entity: credit, requestId: request._id, action: "SUPPLIER_CREDIT_RECOVERED", user, req, module: "ACCOUNTING", newValues: { amount: value, reference: referenceText, remaining: credit.remainingAmount, journal: journal.entryNumber }, session });
    return { supplierCredit: credit, journal };
  });
}
