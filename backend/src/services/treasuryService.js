import { assertRequestActive, assertPostingAllowed, syncFinancialProgress, getFinancialProgress } from "./financialProgressService.js";
import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import PaymentBatch from "../models/PaymentBatch.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Reconciliation from "../models/Reconciliation.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { getBankFileAdapter, assertBbvaSource } from "../integrations/banks/index.js";
import { createPaymentJournal } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { markBudgetPaidAmount } from "./budgetService.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { guardAccountingPeriod, periodFromDate } from "./periodService.js";
import { notifyRoles, notifyUser, resolveNotification } from "./notificationService.js";
import {
  listEligibleSupplierPaymentAccounts,
  resolvePaymentDestination,
  usesEmployeeReimbursementDestination
} from "./paymentDestinationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "./queryService.js";
import { nextPaymentBatchNumber } from "./sequenceService.js";
import { cleanupUploadedFiles, generatedRoot, persistUploadedFiles } from "./storageService.js";
import { runFinancialOperation } from "./transactionService.js";
import { transitionRequest } from "./workflowService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, DEFAULT_RENDITION_OVERDUE_DAYS, ERROR_CODES, FINANCE_CONFIGURATION_KEYS, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../utils/constants.js";

async function renditionDueDate(fromDate) {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.RENDITION_OVERDUE_DAYS, fromDate);
  const days = configuration ? Number(configuration.numericValue) : DEFAULT_RENDITION_OVERDUE_DAYS;
  return new Date(new Date(fromDate).getTime() + days * 24 * 60 * 60 * 1000);
}
import { moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney } from "../utils/money.js";

const bankFilesDir = path.join(generatedRoot, "bank-files");

function isPurchaseOrderInvoiceFlow(accountsPayable) {
  return [FLOW_TYPE.A1, FLOW_TYPE.A2].includes(accountsPayable?.flowType);
}

// MANUAL_EXCEPTION vouchers are explicitly non-authoritative (see manualSunatOverride) - they
// must never quietly clear Treasury the same way a real VALID result does.
const BLOCKING_VOUCHER_VALIDATION_STATUSES = new Set(["OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "OBSERVED_BATCH", "MANUAL_EXCEPTION"]);

// Authoritative Treasury-side gate: a CXP with any unresolved observation (SunatVoucher.validationStatus
// for A1/direct registrations, or an OPEN InvoiceObservation for A2 batch invoices) must never be
// schedulable or included in a BBVA batch, regardless of the parent request's own status.
export async function assertNoBlockingObservation(accountsPayable, { requestNumber } = {}) {
  const label = requestNumber ? `${requestNumber}: ` : "";
  if (accountsPayable.sunatVoucher) {
    const voucher = await SunatVoucher.findById(accountsPayable.sunatVoucher).select("validationStatus observationDetail").lean();
    if (voucher && BLOCKING_VOUCHER_VALIDATION_STATUSES.has(voucher.validationStatus)) {
      throw new AppError(409, `${label}this CXP has an unresolved ${voucher.validationStatus} observation and cannot be scheduled until it is resolved.`, { accountsPayableId: accountsPayable._id, validationStatus: voucher.validationStatus, detail: voucher.observationDetail }, ERROR_CODES.PAYABLE_BLOCKING_OBSERVATION);
    }
  }
  const openObservation = await InvoiceObservation.findOne({ accountsPayable: accountsPayable._id, resolutionStatus: "OPEN" }).select("status errorDetail").lean();
  if (openObservation) {
    throw new AppError(409, `${label}this CXP has an unresolved ${openObservation.status} observation and cannot be scheduled until it is resolved.`, { accountsPayableId: accountsPayable._id, validationStatus: openObservation.status, detail: openObservation.errorDetail }, ERROR_CODES.PAYABLE_BLOCKING_OBSERVATION);
  }
}

function appendPaymentConfirmation(request, accountsPayable, payload, user, confirmedAmount) {
  request.payment ||= {};
  request.payment.confirmations ||= [];
  // Partial payments mean the same AP can be confirmed more than once - dedupe on
  // AP + operation number so a distinct installment is always recorded, while a
  // literal retry of the exact same bank operation doesn't double-count.
  const operationNumber = String(payload.operationNumber || "").trim();
  const alreadyStored = request.payment.confirmations.some((item) =>
    String(item.accountsPayable || "") === String(accountsPayable._id) && item.operationNumber === operationNumber);
  if (!alreadyStored) {
    request.payment.confirmations.push({
      accountsPayable: accountsPayable._id,
      paymentBatch: accountsPayable.paymentBatch,
      operationNumber,
      paidAt: payload.paidAt,
      amount: confirmedAmount,
      currency: accountsPayable.currency,
      confirmedAt: new Date(),
      confirmedBy: user._id,
      comments: payload.comments
    });
  }
  const confirmations = request.payment.confirmations;
  request.payment.confirmedAmount = sumMoney(confirmations.map((item) => item.amount || 0));
  request.payment.operationNumber = confirmations.length === 1
    ? confirmations[0].operationNumber
    : `MULTI-${confirmations.length}`;
  const latestPaidAt = confirmations
    .map((item) => new Date(item.paidAt || 0))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  request.payment.paidAt = latestPaidAt || payload.paidAt;
  request.payment.comments = payload.comments || request.payment.comments;
  request.payment.confirmedAt = new Date();
  request.payment.confirmedBy = user._id;
}

function selectedAccountId(accountSelections, requestId, payableId) {
  if (Array.isArray(accountSelections)) {
    const item = accountSelections.find((value) => String(value.accountsPayableId || value.payableId || value.requestId) === String(payableId || requestId));
    return item?.bankAccountId;
  }
  return accountSelections?.[String(payableId)] || accountSelections?.[String(requestId)];
}

async function paymentRows({ requestIds = [], payableIds = [] }) {
  if (payableIds.length) {
    const ids = [...new Set(payableIds.map(String))];
    if (ids.length !== payableIds.length) throw new AppError(422, "A payable cannot be selected twice.", undefined, ERROR_CODES.VALIDATION_ERROR);
    const payables = await AccountsPayable.find({ _id: { $in: ids } });
    if (payables.length !== ids.length) throw new AppError(404, "One or more selected CXP records were not found.", undefined, ERROR_CODES.NOT_FOUND);
    const requests = await FinancialRequest.find({ _id: { $in: payables.map((ap) => ap.request) } })
      .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
      .populate("supplier");
    const requestMap = new Map(requests.map((request) => [String(request._id), request]));
    return payables.map((accountsPayable) => ({ accountsPayable, request: requestMap.get(String(accountsPayable.request)) }));
  }
  const ids = [...new Set(requestIds.map(String))];
  if (!ids.length) throw new AppError(422, "Select at least one payable request.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (ids.length !== requestIds.length) throw new AppError(422, "A request cannot be selected twice.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const requests = await FinancialRequest.find({ _id: { $in: ids } })
    .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
    .populate("supplier");
  if (requests.length !== ids.length) throw new AppError(404, "One or more selected requests were not found.", undefined, ERROR_CODES.NOT_FOUND);
  const rows = [];
  for (const request of requests) {
    const accountsPayable = await AccountsPayable.findOne({ request: request._id, status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED] } }).sort({ paymentPriority: -1, dueDate: 1, createdAt: 1 });
    rows.push({ request, accountsPayable });
  }
  return rows;
}

async function loadPaymentItems(selection, bank, currency, accountSelections = {}) {
  assertBbvaSource(bank);
  const rows = await paymentRows(selection);
  const items = [];
  for (const { request, accountsPayable } of rows) {
    if (!request) throw new AppError(404, "The request for a selected CXP no longer exists.", undefined, ERROR_CODES.NOT_FOUND);
    assertRequestActive(request);
    if (![REQUEST_STATUS.ACCOUNTED, REQUEST_STATUS.SCHEDULED, REQUEST_STATUS.BANK_FILE_GENERATED, REQUEST_STATUS.PAYMENT_BOUNCED, REQUEST_STATUS.BUDGET_COMMITTED, REQUEST_STATUS.OBSERVED_BATCH, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED].includes(canonicalRequestStatus(request.status))) {
      throw new AppError(409, `${request.requestNumber} is not eligible for Treasury scheduling.`, { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    }
    if (!accountsPayable || !accountsPayable.provisionJournal || ![AP_STATUS.OPEN, AP_STATUS.SCHEDULED].includes(accountsPayable.status) || accountsPayable.paymentBatch) {
      throw new AppError(409, `${request.requestNumber} CXP is not available for a new payment batch.`, { status: accountsPayable?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
    }
    await assertNoBlockingObservation(accountsPayable, { requestNumber: request.requestNumber });
    if (accountsPayable.currency !== currency) throw new AppError(422, `${request.requestNumber} CXP uses ${accountsPayable.currency}; one batch can contain only ${currency}.`, undefined, ERROR_CODES.VALIDATION_ERROR);
    const destination = await resolvePaymentDestination({ request, accountsPayable, currency, selectedAccountId: selectedAccountId(accountSelections, request._id, accountsPayable._id) });
    const employee = accountsPayable.beneficiarySnapshot;
    items.push({
      request,
      accountsPayable,
      bankAccount: destination.account,
      requestNumber: request.requestNumber,
      supplierIdentifier: accountsPayable.supplierIdentifierSnapshot || request.supplier?.normalizedIdentifier || request.supplier?.rucDni || employee?.employeeCode,
      supplierName: request.supplier?.legalName || request.supplier?.name || employee?.name || "UMA collaborator",
      amount: accountsPayable.outstandingAmount,
      // Advances have no fiscal invoice number. Retain the unique year and
      // request sequence within BBVA's 12-byte reference field.
      paymentReference: accountsPayable.flowType === FLOW_TYPE.C ? request.requestNumber.replace(/^(SOL|REQ)-/, "") : undefined,
      currency,
      bankAccountSnapshot: destination.snapshot,
      priority: accountsPayable.paymentPriority || "NORMAL"
    });
  }
  return items;
}

async function scheduleLoadedItem(item, paymentDate, user, req, session) {
  const { request, accountsPayable, bankAccountSnapshot } = item;
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "SCHEDULE", user, req, module: "TREASURY", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  if (accountsPayable.status === AP_STATUS.OPEN) {
    accountsPayable.scheduledFor = new Date(paymentDate);
    accountsPayable.status = AP_STATUS.SCHEDULED;
    accountsPayable.bankAccountSnapshot = bankAccountSnapshot;
    accountsPayable.history.push({ status: AP_STATUS.SCHEDULED, by: user._id, comments: `Scheduled for ${new Date(paymentDate).toISOString().slice(0, 10)}.` });
    await accountsPayable.save({ session });
  }
  await syncFinancialProgress({ request, user, req, session, action: "PAYMENT_SCHEDULED" });
  await recordAudit({ entityType: "AccountsPayable", entity: accountsPayable, requestId: request._id, action: "PAYMENT_DESTINATION_SELECTED", user, req, module: "TREASURY", newValues: { sourceType: bankAccountSnapshot.sourceType, bankAccountId: bankAccountSnapshot.bankAccountId || bankAccountSnapshot.employeeBankAccountId, bank: bankAccountSnapshot.bank, currency: bankAccountSnapshot.currency, accountType: bankAccountSnapshot.accountType, accountLast4: String(bankAccountSnapshot.accountNumber || bankAccountSnapshot.cci || "").slice(-4) }, session });
}

async function countMissingPaymentDestinations(query, bank) {
  const accountChecks = [
    { $eq: ["$supplier", "$$supplierId"] },
    { $eq: ["$currency", "$$currency"] },
    { $eq: ["$active", true] },
    { $eq: ["$accountType", "CURRENT"] },
    {
      $or: [
        { $and: [{ $eq: ["$verificationStatus", "VERIFIED"] }, { $in: ["$ownershipResult", ["MATCH", "MANUAL_ACCEPTED"]] }] },
        { $and: [{ $eq: ["$verificationStatus", "LEGACY_ACCEPTED"] }, { $ne: ["$ownershipResult", "MISMATCH"] }] }
      ]
    }
  ];
  const employeeChecks = [
    { $in: ["$requestDoc.requestType", [REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, REQUEST_TYPE.ENTREGA_RENDIR]] },
    { $ne: [{ $ifNull: ["$requestDoc.rendition.reimbursementBankSnapshot.profile", null] }, null] },
    { $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.verificationStatus", "VERIFIED"] },
    { $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.currency", "$currency"] }
  ];
  if (bank) {
    accountChecks.push({ $eq: ["$bank", bank] });
    employeeChecks.push({ $eq: ["$requestDoc.rendition.reimbursementBankSnapshot.bank", bank] });
  }
  const [result] = await AccountsPayable.aggregate([
    { $match: query },
    { $lookup: { from: FinancialRequest.collection.name, localField: "request", foreignField: "_id", as: "requestRows" } },
    { $set: { requestDoc: { $arrayElemAt: ["$requestRows", 0] } } },
    {
      $lookup: {
        from: SupplierBankAccount.collection.name,
        let: { supplierId: "$supplier", currency: "$currency" },
        pipeline: [{ $match: { $expr: { $and: accountChecks } } }],
        as: "eligibleAccounts"
      }
    },
    {
      $match: {
        $expr: {
          $and: [
            { $eq: [{ $ifNull: ["$bankAccountSnapshot.bank", null] }, null] },
            { $eq: [{ $and: employeeChecks }, false] },
            { $eq: [{ $size: "$eligibleAccounts" }, 0] }
          ]
        }
      }
    },
    { $count: "count" }
  ]);
  return result?.count || 0;
}

export async function listTreasuryQueue(queryParams) {
  const query = { status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED] } };
  if (queryParams.status) query.status = queryParams.status;
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.supplier) query.supplier = queryParams.supplier;
  if (queryParams.flowType) query.flowType = queryParams.flowType;
  if (queryParams.paymentPriority) query.paymentPriority = queryParams.paymentPriority;
  if (queryParams.beneficiaryBank) {
    const normalizedBank = String(queryParams.beneficiaryBank).toUpperCase();
    const supplierIds = await SupplierBankAccount.distinct("supplier", {
      bank: normalizedBank,
      active: true,
      accountType: "CURRENT",
      $or: [
        { verificationStatus: "VERIFIED", ownershipResult: { $in: ["MATCH", "MANUAL_ACCEPTED"] } },
        { verificationStatus: "LEGACY_ACCEPTED", ownershipResult: { $ne: "MISMATCH" } }
      ]
    });
    const employeeRequestIds = await FinancialRequest.distinct("_id", {
      requestType: { $in: [REQUEST_TYPE.REEMBOLSO_CON_SUSTENTO, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, REQUEST_TYPE.ENTREGA_RENDIR] },
      "rendition.reimbursementBankSnapshot.bank": normalizedBank
    });
    query.$and = [...(query.$and || []), { $or: [
      { supplier: { $in: supplierIds } },
      { "bankAccountSnapshot.bank": normalizedBank },
      { request: { $in: employeeRequestIds } }
    ] }];
  }
  if (queryParams.costCenter) {
    const requestIds = await FinancialRequest.distinct("_id", { "lines.costCenter": queryParams.costCenter });
    query.request = { $in: requestIds };
  }
  if (queryParams.requestType) {
    const requestIds = await FinancialRequest.distinct("_id", { requestType: queryParams.requestType });
    const currentIds = query.request?.$in;
    query.request = { $in: currentIds ? requestIds.filter((id) => currentIds.some((current) => String(current) === String(id))) : requestIds };
  }
  if (queryParams.paymentDate) {
    const start = new Date(`${queryParams.paymentDate}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    query.dueDate = { $gte: start, $lt: end };
  }
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, requestIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }, { normalizedIdentifier: search }] }),
      FinancialRequest.distinct("_id", { $or: [{ requestNumber: search }, { "lines.costCenterSnapshot.code": search }] })
    ]);
    query.$and = [...(query.$and || []), { $or: [
      { supplierIdentifierSnapshot: search },
      { "voucher.series": search },
      { "voucher.number": search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } }
    ] }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["dueDate", "outstandingAmount", "currency", "createdAt", "status", "paymentPriority", "flowType"], { paymentPriority: -1, dueDate: 1, createdAt: 1 });
  const [records, total, totalsByCurrency, missingBankDetails] = await Promise.all([
    AccountsPayable.find(query)
      .populate({
        path: "request",
        select: "+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci",
        populate: [{ path: "lines.costCenter" }, { path: "lines.expenseType" }, { path: "requester", select: "name area" }]
      })
      .populate("supplier")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query),
    AccountsPayable.aggregate([{ $match: query }, { $group: { _id: "$currency", total: { $sum: "$outstandingAmount" }, count: { $sum: 1 } } }]),
    countMissingPaymentDestinations(query, queryParams.beneficiaryBank ? String(queryParams.beneficiaryBank).toUpperCase() : undefined)
  ]);
  const data = await Promise.all(records.map(async (accountsPayable) => {
    const object = accountsPayable.toObject();
    const request = object.request;
    const frozen = object.bankAccountSnapshot?.bank ? object.bankAccountSnapshot : null;
    if (usesEmployeeReimbursementDestination(request)) {
      const source = request.rendition.reimbursementBankSnapshot;
      const paymentDestination = frozen || {
        sourceType: "EMPLOYEE_REIMBURSEMENT",
        employeeBankAccountId: source.profile,
        bank: source.bank,
        currency: source.currency,
        accountType: "CURRENT",
        accountHolderName: source.accountHolderName,
        accountNumber: source.accountNumber,
        cci: source.cci,
        verificationStatus: source.verificationStatus,
        capturedAt: source.capturedAt
      };
      return { ...request, requestId: request._id, _id: object._id, accountsPayable: object, supplier: object.supplier, activeBankAccounts: [], eligibleBankAccounts: [], paymentDestination, destinationLocked: true };
    }
    const accounts = accountsPayable.supplier ? await listEligibleSupplierPaymentAccounts({ supplierId: accountsPayable.supplier._id, currency: object.currency }) : [];
    return {
      ...request,
      requestId: request._id,
      _id: object._id,
      accountsPayable: object,
      supplier: object.supplier,
      activeBankAccounts: accounts,
      eligibleBankAccounts: accounts,
      paymentDestination: frozen,
      destinationLocked: Boolean(frozen && object.status === AP_STATUS.SCHEDULED)
    };
  }));
  return {
    ...paginatedPayload(data, total, page, pageSize),
    summary: {
      totalsByCurrency: Object.fromEntries(totalsByCurrency.map((item) => [item._id, { total: item.total, count: item.count }])),
      missingBankDetails
    }
  };
}

export async function getEligiblePaymentDestinations({ requestId, bank, currency }) {
  const request = await FinancialRequest.findById(requestId)
    .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
    .populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  const accountsPayable = await AccountsPayable.findOne({ request: request._id });
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  if (accountsPayable.status === AP_STATUS.SCHEDULED && accountsPayable.bankAccountSnapshot?.bank) {
    return { sourceType: accountsPayable.bankAccountSnapshot.sourceType || "SUPPLIER", locked: true, selected: accountsPayable.bankAccountSnapshot, accounts: [accountsPayable.bankAccountSnapshot] };
  }
  if (usesEmployeeReimbursementDestination(request)) {
    const source = request.rendition.reimbursementBankSnapshot;
    const selected = {
      sourceType: "EMPLOYEE_REIMBURSEMENT",
      employeeBankAccountId: source.profile,
      bank: source.bank,
      currency: source.currency,
      accountType: "CURRENT",
      accountHolderName: source.accountHolderName,
      accountNumber: source.accountNumber,
      cci: source.cci,
      verificationStatus: source.verificationStatus,
      capturedAt: source.capturedAt
    };
    return { sourceType: selected.sourceType, locked: true, selected, accounts: [selected] };
  }
  const accounts = await listEligibleSupplierPaymentAccounts({ supplierId: request.supplier._id, currency: currency || request.currency });
  return { sourceType: "SUPPLIER", locked: false, selected: accounts[0] || null, accounts };
}

export async function schedulePayments({ requestIds = [], payableIds = [], bank, currency, paymentDate, accountSelections, user, req }) {
  if ((!Array.isArray(requestIds) || !requestIds.length) && (!Array.isArray(payableIds) || !payableIds.length)) throw new AppError(422, "Select at least one payable CXP.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (!paymentDate) throw new AppError(422, "A payment date is required.", { field: "paymentDate" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedBank = String(bank || "").toUpperCase();
  const items = await loadPaymentItems({ requestIds, payableIds }, normalizedBank, currency, accountSelections);
  await runFinancialOperation(async (session) => {
    for (const item of items) await scheduleLoadedItem(item, paymentDate, user, req, session);
  });
  return items.map((item) => item.request);
}

export async function generatePaymentBatch({ requestIds = [], payableIds = [], bank, currency, paymentDate, accountSelections, user, req }) {
  if ((!Array.isArray(requestIds) || !requestIds.length) && (!Array.isArray(payableIds) || !payableIds.length)) throw new AppError(422, "Select at least one payable CXP.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (!paymentDate) throw new AppError(422, "A payment date is required.", { field: "paymentDate" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedBank = String(bank || "").trim().toUpperCase();
  assertBbvaSource(normalizedBank);
  const configuration = await BankFormatConfiguration.findOne({ bank: "BBVA", currency, active: true }).lean();
  const adapter = getBankFileAdapter(normalizedBank, configuration);
  // Snapshot the certification state that applied AT GENERATION TIME. This is copied onto the
  // batch/file below and must never be re-derived from the live configuration later — certifying
  // (or decertifying) the configuration afterwards must not retroactively change what an
  // already-generated file reports.
  const certificationSnapshot = {
    certified: configuration.certified === true,
    certifiedAt: configuration.certifiedAt || null,
    certifiedBy: configuration.certifiedBy || null,
    certificationReference: configuration.certificationReference || "",
    specificationVersion: configuration.specificationVersion
  };
  const items = await loadPaymentItems({ requestIds, payableIds }, normalizedBank, currency, accountSelections);
  adapter.validateBatch(items.map((item) => ({ ...item, bankAccount: item.bankAccountSnapshot })));
  const batchNumber = await nextPaymentBatchNumber(paymentDate);
  const adapterItems = items.map((item) => ({ ...item, bankAccount: item.bankAccountSnapshot }));
  const content = adapter.generateFile({ batchNumber, paymentDate, currency, items: adapterItems });
  const fileName = adapter.getFileName(batchNumber);
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  const filePath = path.join(bankFilesDir, fileName);
  const claims = AccountsPayable.db.collection("bbvapaymentgenerationclaims");
  let fileWritten = false;

  try {
    // Atomic claims also protect deployments using a standalone MongoDB server.
    for (const item of [...items].sort((a,b) => String(a.accountsPayable._id).localeCompare(String(b.accountsPayable._id)))) {
      try {
        await claims.insertOne({ _id: item.accountsPayable._id, batchNumber, claimedAt: new Date() });
      } catch (error) {
        if (error.code === 11000) throw new AppError(409, "A selected CXP is already being included in another BBVA file.");
        throw error;
      }
      const current = await AccountsPayable.findById(item.accountsPayable._id).select("status paymentBatch updatedAt").lean();
      if (!current || current.paymentBatch || ![AP_STATUS.OPEN,AP_STATUS.SCHEDULED].includes(current.status) || String(current.updatedAt) !== String(item.accountsPayable.updatedAt)) throw new AppError(409, "Selected CXP changed during BBVA generation. Refresh Treasury before retrying.");
    }
    await fs.mkdir(bankFilesDir, { recursive: true });
    await fs.writeFile(filePath, content, { flag: "wx" });
    fileWritten = true;
    const result = await runFinancialOperation(async (session) => {
      for (const item of items) await scheduleLoadedItem(item, paymentDate, user, req, session);
      const [batch] = await PaymentBatch.create([{
        batchNumber,
        bank: normalizedBank,
        currency,
        paymentDate,
        items: items.map((item) => ({
          accountsPayable: item.accountsPayable._id,
          request: item.request._id,
          requestNumber: item.requestNumber,
          supplier: item.request.supplier?._id,
          supplierIdentifier: item.supplierIdentifier,
          supplierName: item.supplierName,
          bankAccount: item.bankAccountSnapshot,
          amount: item.amount,
          currency,
          priority: item.priority
        })),
        totalAmount: sumMoney(items.map((item) => item.amount)),
        priority: items.every((item) => item.priority === "PRIORITY") ? "PRIORITY" : items.some((item) => item.priority === "PRIORITY") ? "MIXED" : "NORMAL",
        fileName,
        filePath,
        url: `/generated/bank-files/${fileName}`,
        checksum,
        paymentCount: items.length,
        formatSnapshot: configuration.bbva,
        adapterMode: adapter.mode,
        specificationVersion: adapter.specificationVersion,
        certificationSnapshot,
        status: "GENERATED",
        generatedBy: user._id,
        generatedAt: new Date()
      }], session ? { session } : undefined);

      for (const item of items) {
        await recordAudit({ entityType: "AccountsPayable", entity: item.accountsPayable, requestId: item.request._id,
          action: "BBVA_TXT_GENERATED", user, req, module: "TREASURY", session,
          statusFrom: item.request.status, statusTo: item.request.status,
          comments: `BBVA batch ${batchNumber}; payment awaits bank confirmation.`,
          oldValues: { payableStatus: item.accountsPayable.status }, newValues: { payableStatus: AP_STATUS.PAYMENT_FILE_CREATED, batchId: batch._id, checksum } });
        item.accountsPayable.status = AP_STATUS.PAYMENT_FILE_CREATED;
        item.accountsPayable.paymentBatch = batch._id;
        item.accountsPayable.bankAccountSnapshot = item.bankAccountSnapshot;
        item.accountsPayable.history.push({ status: AP_STATUS.PAYMENT_FILE_CREATED, by: user._id, comments: `Included in BBVA batch ${batchNumber}. Payment is not yet confirmed.` });
        await item.accountsPayable.save({ session });
        if (!isPurchaseOrderInvoiceFlow(item.accountsPayable)) {
          item.request.paymentBatch = batch._id;
          item.request.bankFile = { bank: normalizedBank, fileName, url: batch.url, generatedAt: new Date(), generatedBy: user._id };

        }
      }
      for (const request of new Map(items.map(item => [String(item.request._id), item.request])).values()) await syncFinancialProgress({ request, user, req, session, action: "BANK_FILE_GENERATED" });
      await GeneratedFile.create([{
        kind: "BANK_TXT",
        fileName,
        url: `/generated/bank-files/${fileName}`,
        requestIds: items.map((item) => item.request._id),
        requestNumbers: items.map((item) => item.requestNumber),
        totals: [{ currency, total: sumMoney(items.map((item) => item.amount)), count: items.length }],
        rowCount: items.length,
        generatedBy: user._id,
        metadata: {
          batchNumber,
          batchId: batch._id,
          checksum,
          currency,
          paymentCount: items.length,
          totalAmount: batch.totalAmount,
          generatedAt: batch.generatedAt,
          bank: normalizedBank,
          paymentDate,
          adapterMode: adapter.mode,
          specificationVersion: adapter.specificationVersion,
          certificationSnapshot,
          paymentConfirmed: false,
          paymentEntriesCreated: false,
          notice: "BBVA fixed-width payment instruction. Payment requires separate bank confirmation."
        }
      }], session ? { session } : undefined);
      await recordAudit({
        entityType: "PaymentBatch",
        entity: batch,
        action: "GENERATED_BBVA_BANK_FILE",
        user,
        req,
        module: "TREASURY",
        message: "BBVA fixed-width file generated; payment awaits bank confirmation.",
        newValues: { batchId: batch._id, batchNumber, bank: normalizedBank, currency, totalAmount: batch.totalAmount, itemCount: items.length, checksum, specificationVersion: adapter.specificationVersion, generatedAt: batch.generatedAt, adapterMode: adapter.mode },
        session
      });
      return { batch, content };
    });
    for (const item of items) {
      await resolveNotification(`request:${item.request._id}:treasury`);
      await notifyRoles({
        roles: ["Treasury"],
        eventKey: `request:${item.request._id}:payment-confirmation:${item.accountsPayable._id}`,
        type: "PAYMENT_CONFIRMATION",
        title: "Payment confirmation required",
        message: `${item.requestNumber} is in ${batchNumber}; confirm it only after bank execution.`,
        path: "/treasury",
        entityType: "FinancialRequest",
        entityId: item.request._id
      });
    }
    return result;
  } catch (error) {
    // Keep the original bytes if a batch exists, even if a subsequent notification fails.
    if (fileWritten && !await PaymentBatch.exists({ batchNumber })) await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await claims.deleteMany({ batchNumber });
  }
}

async function confirmPayable({ accountsPayable, payload, user, req }) {
  const operationNumber = String(payload.operationNumber || "").trim();
  if (!operationNumber || !payload.paidAt || payload.confirmedAmount === undefined) {
    throw new AppError(422, "Operation number, actual payment date, and confirmed amount are required.", { required: ["operationNumber", "paidAt", "confirmedAmount"] }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!accountsPayable || ![AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID].includes(accountsPayable.status)) {
    throw new AppError(409, "The CXP is not awaiting payment confirmation.", { status: accountsPayable?.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  const request = await FinancialRequest.findById(accountsPayable.request).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId: accountsPayable.request }, ERROR_CODES.NOT_FOUND);
  assertRequestActive(request);
  const purchaseOrderFlow = isPurchaseOrderInvoiceFlow(accountsPayable);
  if (!purchaseOrderFlow && request.status !== REQUEST_STATUS.BANK_FILE_GENERATED) {
    throw new AppError(409, "Payment can only be confirmed after bank-file generation.", { status: request.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (Number.isNaN(new Date(payload.paidAt).getTime())) throw new AppError(422, "A valid actual payment date is required.");
  if (new Date(payload.paidAt).getTime() > Date.now()) throw new AppError(422, "A future payment cannot be confirmed as executed.");
  if (!Number.isFinite(Number(payload.confirmedAmount)) || Number(payload.confirmedAmount) <= 0) throw new AppError(422, "A positive confirmed amount is required.");
  await assertNoBlockingObservation(accountsPayable, { requestNumber: request.requestNumber });
  await guardAccountingPeriod({ period: periodFromDate(payload.paidAt), action: "POST", user, req, module: "TREASURY", entityId: request._id, requestId: request._id });
  const confirmedAmount = roundMoney(payload.confirmedAmount);
  if (confirmedAmount > accountsPayable.outstandingAmount && !moneyEquals(confirmedAmount, accountsPayable.outstandingAmount)) {
    throw new AppError(422, "Confirmed amount cannot exceed the outstanding CXP amount.", { confirmedAmount, outstandingAmount: accountsPayable.outstandingAmount }, ERROR_CODES.VALIDATION_ERROR);
  }
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "CONFIRM_PAYMENT", user, req, module: "TREASURY", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });

  const sourceBatch = accountsPayable.paymentBatch ? await PaymentBatch.findById(accountsPayable.paymentBatch).select("bank") : null;
  const result = await runFinancialOperation(async (session) => {
    appendPaymentConfirmation(request, accountsPayable, payload, user, confirmedAmount);
    const paymentJournal = await createPaymentJournal(request, accountsPayable, user._id, {
      paymentDate: payload.paidAt,
      bank: sourceBatch?.bank || request.bankFile?.bank || accountsPayable.bankAccountSnapshot?.bank,
      session
    });
    const remainingOutstanding = subtractMoney(accountsPayable.outstandingAmount, confirmedAmount);
    const fullyPaid = remainingOutstanding <= 0 || moneyEquals(remainingOutstanding, 0);
    accountsPayable.status = fullyPaid ? AP_STATUS.PAID : AP_STATUS.PARTIALLY_PAID;
    accountsPayable.outstandingAmount = fullyPaid ? 0 : remainingOutstanding;
    accountsPayable.paidDate = fullyPaid ? payload.paidAt : accountsPayable.paidDate;
    accountsPayable.paymentJournal = paymentJournal._id;
    accountsPayable.history.push({ status: accountsPayable.status, by: user._id, comments: `Payment confirmed: ${operationNumber} (${confirmedAmount.toFixed(2)}${fullyPaid ? "" : `, ${remainingOutstanding.toFixed(2)} remaining`}).` });

    if (accountsPayable.flowType !== FLOW_TYPE.C) {
      const paidPenEquivalent = roundMoney(multiplyMoney(confirmedAmount, accountsPayable.exchangeRate));
      await markBudgetPaidAmount(request, user._id, paidPenEquivalent, {
        session,
        comments: `Treasury confirmed CXP ${accountsPayable._id} with operation ${operationNumber}.`
      });
      accountsPayable.budgetPaidAt ||= new Date();
    }
    await accountsPayable.save({ session });

    const batch = await PaymentBatch.findById(accountsPayable.paymentBatch).session(session || null);
    if (batch && fullyPaid) {
      const item = batch.items.find((value) => String(value.accountsPayable) === String(accountsPayable._id));
      if (item) item.status = "CONFIRMED";
      const activeItems = batch.items.filter((value) => value.status !== "CANCELLED");
      const confirmed = activeItems.filter((value) => value.status === "CONFIRMED").length;
      const rejected = activeItems.filter((value) => value.status === "REJECTED").length;
      batch.status = confirmed === activeItems.length
        ? "CONFIRMED"
        : confirmed || rejected
          ? "PARTIALLY_CONFIRMED"
          : batch.status;
      await batch.save({ session });
    }

    if (fullyPaid && (accountsPayable.flowType === FLOW_TYPE.C || request.flowType === FLOW_TYPE.C)) {
      request.rendition ||= {};
      request.rendition.status = "PENDING";
      request.rendition.amountAdvanced = accountsPayable.originalAmount;
      request.rendition.balanceOutstanding = accountsPayable.originalAmount;
      request.rendition.dueAt = await renditionDueDate(payload.paidAt);
    }
    await syncFinancialProgress({ request, user, req, session, action: "PAYMENT_CONFIRMED" });

    await recordAudit({
      entityType: "AccountsPayable",
      entity: accountsPayable,
      requestId: request._id,
      action: "PAYMENT_CONFIRMED",
      user,
      req,
      module: "TREASURY",
      newValues: { operationNumber, paidAt: payload.paidAt, confirmedAmount, paymentJournal: paymentJournal.entryNumber },
      session
    });
    return { request, accountsPayable, paymentJournal, batch };
  });

  if (!(await AccountsPayable.exists({ request: request._id, status: { $in: [AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID] } }))) await resolveNotification(`request:${request._id}:payment-confirmation`);
  await resolveNotification(`request:${request._id}:payment-confirmation:${accountsPayable._id}`);
  await notifyRoles({ roles: [ROLES.TREASURY], eventKey: `request:${request._id}:reconcile:${accountsPayable._id}`, type: "PAYMENT_RECONCILIATION", title: "Payment ready for reconciliation", message: `${request.requestNumber}: reconcile the confirmed invoice payment.`, path: "/treasury", entityType: "AccountsPayable", entityId: accountsPayable._id });
  if (request.flowType === FLOW_TYPE.C) {
    await notifyUser({ userId: request.requester || request.solicitor, eventKey: `request:${request._id}:rendition`, type: "RENDITION_PENDING", title: "Rendition pending", message: `${request.requestNumber} was paid. Rendition is due within 10 days.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
  } else {
    await notifyUser({ userId: request.requester || request.solicitor, eventKey: `request:${request._id}:paid:${accountsPayable._id}`, type: "PAYMENT_CONFIRMED", title: "Payment confirmed", message: `${request.requestNumber} CXP was paid with operation ${operationNumber}.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
  }
  return result;
}

export async function confirmTreasuryPayable({ accountsPayableId, payload, user, req }) {
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  return confirmPayable({ accountsPayable, payload, user, req });
}

export async function confirmTreasuryPayment({ requestId, payload, user, req }) {
  const accountsPayable = await AccountsPayable.findOne({ request: requestId, status: { $in: [AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID] } }).sort({ createdAt: 1 });
  if (!accountsPayable) throw new AppError(404, "No CXP awaiting payment confirmation was found for this request.", { requestId }, ERROR_CODES.NOT_FOUND);
  return confirmPayable({ accountsPayable, payload, user, req });
}

export async function markPaymentBounced({ accountsPayableId, payload, user, req }) {
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new AppError(422, "A bank rejection reason is required.", { field: "reason" }, ERROR_CODES.VALIDATION_ERROR);
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  if (accountsPayable.status !== AP_STATUS.PAYMENT_FILE_CREATED) throw new AppError(409, "Only a CXP in a generated payment file can be marked bounced.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const request = await FinancialRequest.findById(accountsPayable.request);
  if (!request) throw new AppError(404, "Financial request not found.", { requestId: accountsPayable.request }, ERROR_CODES.NOT_FOUND);
  await assertPostingAllowed(request, { user, req });
  const result = await runFinancialOperation(async (session) => {
    accountsPayable.status = AP_STATUS.PAYMENT_BOUNCED;
    accountsPayable.bouncedPayment = { bouncedAt: new Date(), reason, bankReference: payload.bankReference, reportedBy: user._id };
    accountsPayable.history.push({ status: AP_STATUS.PAYMENT_BOUNCED, by: user._id, comments: reason });
    await accountsPayable.save({ session });
    const batch = await PaymentBatch.findById(accountsPayable.paymentBatch).session(session || null);
    if (batch) {
      const item = batch.items.find((value) => String(value.accountsPayable) === String(accountsPayable._id));
      if (item) {
        item.status = "REJECTED";
        item.rejection = { reason, bankReference: payload.bankReference, rejectedAt: new Date(), rejectedBy: user._id };
      }
      const activeItems = batch.items.filter((value) => value.status !== "CANCELLED");
      const rejectedCount = activeItems.filter((value) => value.status === "REJECTED").length;
      const confirmedCount = activeItems.filter((value) => value.status === "CONFIRMED").length;
      batch.status = rejectedCount === activeItems.length
        ? "REJECTED"
        : confirmedCount || rejectedCount
          ? "PARTIALLY_CONFIRMED"
          : batch.status;
      await batch.save({ session });
    }
    await syncFinancialProgress({ request, user, req, session, action: "PAYMENT_BOUNCED" });
    await recordAudit({ entityType: "AccountsPayable", entity: accountsPayable, requestId: request._id, action: "PAYMENT_BOUNCED", user, req, module: "TREASURY", comments: reason, newValues: { bankReference: payload.bankReference }, session });
    return { request, accountsPayable, batch };
  });
  await notifyUser({ userId: request.requester || request.solicitor, eventKey: `request:${request._id}:payment-bounced:${accountsPayable._id}`, type: "PAYMENT_BOUNCED", title: "Bank payment rejected", message: `${request.requestNumber}: update the CCI evidence so Treasury can reprogram the payment.`, path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
  return result;
}

export async function reprogramBouncedPayment({ accountsPayableId, payload, files, user, req }) {
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  if (accountsPayable.status !== AP_STATUS.PAYMENT_BOUNCED) throw new AppError(409, "Only a bounced CXP can be reprogrammed.", { status: accountsPayable.status }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  const cciLetter = files?.cciLetter?.[0] || files?.supporting?.[0];
  if (!cciLetter) throw new AppError(422, "A signed CCI letter is required before reprogramming.", { field: "cciLetter" }, ERROR_CODES.MISSING_REQUIRED_DOCUMENT);
  const request = await FinancialRequest.findById(accountsPayable.request).select("+attachments.path");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId: accountsPayable.request }, ERROR_CODES.NOT_FOUND);

  await assertPostingAllowed(request, { user, req });
  let persisted;
  try {
    persisted = await persistUploadedFiles({ cciLetter: [cciLetter] }, { domain: "requests", entityId: request._id });
    const file = persisted.cciLetter[0];
    const attachment = {
      kind: "CCI_LETTER",
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      url: file.url,
      mimetype: file.mimetype,
      size: file.size,
      checksum: file.checksum,
      uploadedBy: user._id
    };

    const result = await runFinancialOperation(async (session) => {
      request.attachments.push(attachment);
      await request.save({ session });
      const savedAttachment = request.attachments[request.attachments.length - 1];

      const batch = await PaymentBatch.findById(accountsPayable.paymentBatch).session(session || null);
      if (batch) {
        const item = batch.items.find((value) => String(value.accountsPayable) === String(accountsPayable._id));
        if (item) item.status = "REPROGRAMMED";
        const openItems = batch.items.filter((value) => !["CONFIRMED", "CANCELLED"].includes(value.status));
        batch.status = openItems.every((value) => value.status === "REPROGRAMMED") ? "REPROGRAMMED" : "PARTIALLY_CONFIRMED";
        await batch.save({ session });
      }

      accountsPayable.status = AP_STATUS.OPEN;
      accountsPayable.paymentBatch = undefined;
      accountsPayable.bankAccountSnapshot = undefined;
      accountsPayable.bouncedPayment = {
        ...(accountsPayable.bouncedPayment?.toObject?.() || accountsPayable.bouncedPayment || {}),
        reprogrammedAt: new Date(),
        reprogrammedBy: user._id,
        replacementBankDocument: savedAttachment._id
      };
      accountsPayable.history.push({ status: AP_STATUS.OPEN, by: user._id, comments: payload.comments || "Reopened after signed CCI replacement evidence." });
      await accountsPayable.save({ session });

      await syncFinancialProgress({ request, user, req, session, action: "PAYMENT_REPROGRAMMED" });
      await recordAudit({
        entityType: "AccountsPayable",
        entity: accountsPayable,
        requestId: request._id,
        action: "PAYMENT_REPROGRAMMED",
        user,
        req,
        module: "TREASURY",
        newValues: { replacementBankDocument: savedAttachment._id },
        session
      });
      return { request, accountsPayable, batch };
    });

    await resolveNotification(`request:${request._id}:payment-bounced:${accountsPayable._id}`);
    await notifyRoles({
      roles: [ROLES.TREASURY],
      eventKey: `request:${request._id}:payment-reprogrammed:${accountsPayable._id}`,
      type: "PAYMENT_REPROGRAMMED",
      title: "Payment ready to reprogram",
      message: `${request.requestNumber} has updated signed CCI evidence and is back in the Treasury queue.`,
      path: "/treasury",
      entityType: "AccountsPayable",
      entityId: accountsPayable._id
    });
    return result;
  } catch (error) {
    if (persisted) await cleanupUploadedFiles(persisted).catch(() => undefined);
    throw error;
  }
}

export async function reconcilePayment({ requestId, accountsPayableId, payload, user, req }) {
  const selected = accountsPayableId ? await AccountsPayable.findById(accountsPayableId) : null;
  if (accountsPayableId && !selected) throw new AppError(404, "Accounts Payable record not found.");
  const request = await FinancialRequest.findById(selected?.request || requestId);
  if (!request) throw new AppError(404, "Financial request not found.");
  await assertPostingAllowed(request, { user, req });
  const payables = selected ? [selected] : await AccountsPayable.find({ request: request._id, status: AP_STATUS.PAID, reconciliation: null });
  if (!payables.length || payables.some(ap => ap.status !== AP_STATUS.PAID || !ap.paymentJournal || ap.reconciliation)) throw new AppError(409, "Select paid, unreconciled obligations.");
  const evidence = await getFinancialProgress(request);
  if (payables.some(ap => !evidence.children.find(child => child.id === String(ap._id))?.paid)) throw new AppError(409, "Actual payment confirmation is required before reconciliation.");
  const bankReference = String(payload.bankReference || "").trim();
  const paidAmount = sumMoney(payables.map(ap => ap.originalAmount));
  if (!bankReference || payload.statementAmount === undefined || !moneyEquals(payload.statementAmount, paidAmount)) throw new AppError(422, "Bank reference and an exact matching statement amount are required.");
  const result = await runFinancialOperation(async session => {
    const reconciliations = [];
    for (const ap of payables) {
      const covered = await Reconciliation.exists({ request: request._id, $or: [{ accountsPayable: ap._id }, { accountsPayables: ap._id }] }).session(session || null);
      if (covered) throw new AppError(409, "This obligation already has reconciliation evidence.");
      const [record] = await Reconciliation.create([{
        scope: "PAYABLE", request: request._id, accountsPayable: ap._id, accountsPayables: [ap._id],
        reconciledBy: user._id, reconciledAt: new Date(), bankReference,
        statementAmount: ap.originalAmount, paidAmount: ap.originalAmount, difference: 0, comments: payload.comments
      }], session ? { session } : undefined);
      ap.reconciliation = record._id; ap.reconciledAt = record.reconciledAt;
      await ap.save({ session });
      request.reconciliation ||= record._id;
      reconciliations.push(record);
      await recordAudit({ entityType: "Reconciliation", entity: record, requestId: request._id, action: "RECONCILED", user, req, module: "TREASURY", newValues: { accountsPayable: ap._id, bankReference, paidAmount: ap.originalAmount }, session });
    }
    await syncFinancialProgress({ request, user, req, session, action: "RECONCILIATION_PROGRESS" });
    return { request, reconciliation: reconciliations[0], reconciliations };
  });
  for (const ap of payables) await resolveNotification(`request:${request._id}:reconcile:${ap._id}`);
  if (request.status === REQUEST_STATUS.RECONCILED) await notifyRoles({
    roles: ["Accounting"], eventKey: `request:${request._id}:close`, type: "ACCOUNTING_CLOSE",
    title: "Request ready for closure review", message: `${request.requestNumber}: all payments reconciled; review remaining closure conditions.`,
    path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id
  });
  return result;
}

export async function listPaymentBatches(queryParams = {}) {
  const query = {};
  if (queryParams.bank) query.bank = String(queryParams.bank).toUpperCase();
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.status) query.status = queryParams.status;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$or = [{ batchNumber: search }, { fileName: search }, { "items.requestNumber": search }, { "items.supplierName": search }];
  }
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["batchNumber", "fileName", "bank", "currency", "totalAmount", "status", "generatedAt"], { generatedAt: -1 });
  const [data, total] = await Promise.all([
    PaymentBatch.find(query).populate("generatedBy", "name email role").sort(sort).skip(skip).limit(pageSize),
    PaymentBatch.countDocuments(query)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

export async function listPaymentConfirmationQueue(queryParams = {}) {
  const { page, pageSize, skip } = parsePagination(queryParams);
  const query = { status: queryParams.status || AP_STATUS.PAYMENT_FILE_CREATED };
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.flowType) query.flowType = queryParams.flowType;
  if (queryParams.paymentPriority) query.paymentPriority = queryParams.paymentPriority;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, requestIds, batchIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }] }),
      FinancialRequest.distinct("_id", { requestNumber: search }),
      PaymentBatch.distinct("_id", { batchNumber: search })
    ]);
    query.$or = [
      { supplierIdentifierSnapshot: search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } },
      { paymentBatch: { $in: batchIds } }
    ];
  }
  const sort = parseSort(queryParams, ["outstandingAmount", "dueDate", "updatedAt", "paymentPriority", "flowType"], { paymentPriority: -1, updatedAt: 1 });
  const [records, total] = await Promise.all([
    AccountsPayable.find(query)
      .populate({ path: "request", populate: { path: "supplier" } })
      .populate("paymentBatch", "batchNumber bank currency paymentDate status")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query)
  ]);
  return paginatedPayload(records.map((ap) => {
    const request = ap.request.toObject();
    return { ...request, requestId: request._id, _id: ap._id, accountsPayable: ap.toObject(), supplier: ap.supplier || request.supplier };
  }), total, page, pageSize);
}

export async function listBouncedPayments(queryParams = {}) {
  const { page, pageSize, skip } = parsePagination(queryParams);
  const query = { status: AP_STATUS.PAYMENT_BOUNCED };
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.flowType) query.flowType = queryParams.flowType;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    const [supplierIds, requestIds, batchIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }] }),
      FinancialRequest.distinct("_id", { requestNumber: search }),
      PaymentBatch.distinct("_id", { batchNumber: search })
    ]);
    query.$or = [
      { supplierIdentifierSnapshot: search },
      { "bouncedPayment.reason": search },
      { "bouncedPayment.bankReference": search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } },
      { paymentBatch: { $in: batchIds } }
    ];
  }
  const sort = parseSort(queryParams, ["dueDate", "updatedAt", "outstandingAmount"], { "bouncedPayment.bouncedAt": -1, updatedAt: -1 });
  const [records, total] = await Promise.all([
    AccountsPayable.find(query)
      .populate({ path: "request", populate: [{ path: "supplier" }, { path: "requester", select: "name email area" }] })
      .populate("supplier", "name legalName rucDni normalizedIdentifier")
      .populate("paymentBatch", "batchNumber bank currency paymentDate status")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query)
  ]);
  return paginatedPayload(records.map((ap) => {
    const request = ap.request?.toObject ? ap.request.toObject() : ap.request;
    return {
      ...(request || {}),
      requestId: request?._id,
      _id: ap._id,
      accountsPayable: ap.toObject(),
      supplier: ap.supplier || request?.supplier
    };
  }), total, page, pageSize);
}

export async function listReconciliationQueue(queryParams = {}) {
  const { page, pageSize, skip } = parsePagination(queryParams);
  const covered = await Reconciliation.find().select("accountsPayable accountsPayables").lean();
  const excluded = covered.flatMap(r => [r.accountsPayable, ...(r.accountsPayables || [])]).filter(Boolean);
  const requestQuery = { status: { $nin: ["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"] } };
  if (queryParams.accountingPeriod) requestQuery.accountingPeriod = queryParams.accountingPeriod;
  if (queryParams.search) requestQuery.requestNumber = new RegExp(escapedRegex(queryParams.search), "i");
  const ids = await FinancialRequest.distinct("_id", requestQuery);
  const query = { status: AP_STATUS.PAID, reconciliation: null, _id: { $nin: excluded }, request: { $in: ids } };
  if (queryParams.currency) query.currency = queryParams.currency;
  const [records, total] = await Promise.all([
    AccountsPayable.find(query).populate({ path: "request", populate: { path: "supplier" } }).sort({ paidDate: 1 }).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query)
  ]);
  return paginatedPayload(records.map(ap => ({
    ...ap.request.toObject(), _id: ap._id, requestId: ap.request._id, payableId: ap._id,
    accountsPayable: ap.toObject(), accountsPayables: [ap.toObject()],
    payment: { ...ap.request.payment?.toObject?.(), operationNumber: ap.request.payment?.confirmations?.find(item => String(item.accountsPayable) === String(ap._id))?.operationNumber || ap.request.payment?.operationNumber, paidAt: ap.paidDate, confirmedAmount: ap.originalAmount }
  })), total, page, pageSize);
}

export async function getEligiblePayablePaymentDestinations({ accountsPayableId, bank, currency }) {
  const accountsPayable = await AccountsPayable.findById(accountsPayableId);
  if (!accountsPayable) throw new AppError(404, "Accounts Payable record not found.", { accountsPayableId }, ERROR_CODES.NOT_FOUND);
  const request = await FinancialRequest.findById(accountsPayable.request)
    .select("+rendition.reimbursementBankSnapshot.accountHolderName +rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci")
    .populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId: accountsPayable.request }, ERROR_CODES.NOT_FOUND);
  if (accountsPayable.status === AP_STATUS.SCHEDULED && accountsPayable.bankAccountSnapshot?.bank) {
    return { sourceType: accountsPayable.bankAccountSnapshot.sourceType || "SUPPLIER", locked: true, selected: accountsPayable.bankAccountSnapshot, accounts: [accountsPayable.bankAccountSnapshot] };
  }
  if (usesEmployeeReimbursementDestination(request)) {
    const source = request.rendition.reimbursementBankSnapshot;
    const selected = { sourceType: "EMPLOYEE_REIMBURSEMENT", employeeBankAccountId: source.profile, bank: source.bank, currency: source.currency, accountType: "CURRENT", accountHolderName: source.accountHolderName, accountNumber: source.accountNumber, cci: source.cci, verificationStatus: source.verificationStatus, capturedAt: source.capturedAt };
    return { sourceType: selected.sourceType, locked: true, selected, accounts: [selected] };
  }
  const accounts = await listEligibleSupplierPaymentAccounts({ supplierId: request.supplier?._id, currency: currency || accountsPayable.currency });
  return { sourceType: "SUPPLIER", locked: false, selected: accounts[0] || null, accounts };
}

// The only way BankFormatConfiguration.certified may change. Kept out of the generic master-data
// field editor so certification is always a deliberate, audited administrative/Finance decision,
// distinct from a routine configuration edit (see masterDataController.js).
export async function certifyBankFormatConfiguration({ id, certified, certificationReference, user, req }) {
  if (![ROLES.ADMIN, ROLES.TREASURY].includes(user?.role)) throw new AppError(403, "Only authorized bank configuration administrators may certify the format.");
  if (typeof certified !== "boolean") throw new AppError(422, "Certification must be a boolean.");
  const configuration = await BankFormatConfiguration.findById(id);
  if (!configuration) throw new AppError(404, "BankFormatConfiguration not found.", { id }, ERROR_CODES.NOT_FOUND);
  const isCertified = Boolean(certified);
  const reference = String(certificationReference || "").trim();
  if (isCertified && !reference) {
    throw new AppError(422, "A certification reference/comment is required when marking a format certified.", { field: "certificationReference" }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (isCertified) getBankFileAdapter(configuration.bank, { ...configuration.toObject(), certified: true });
  const oldValues = configuration.toObject();
  configuration.certified = isCertified;
  configuration.certifiedAt = isCertified ? new Date() : null;
  configuration.certifiedBy = isCertified ? user._id : null;
  configuration.certificationReference = isCertified ? reference : "";
  await configuration.save();
  await recordAudit({
    entityType: "BankFormatConfiguration",
    entity: configuration,
    action: isCertified ? "BBVA_FORMAT_CERTIFIED" : "BBVA_FORMAT_DECERTIFIED",
    user,
    req,
    module: "TREASURY",
    comments: reference,
    oldValues,
    newValues: configuration.toObject()
  });
  return configuration;
}
