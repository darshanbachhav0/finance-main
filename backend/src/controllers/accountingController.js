import AccountsPayable from "../models/AccountsPayable.js";
import AccountingEntry from "../models/AccountingEntry.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Supplier from "../models/Supplier.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getConsolidation, processAccountsPayable } from "../services/accountingService.js";
import { flattenConsolidationRow, persistReportFile, toCsv } from "../services/exportService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { publicRequestPayload, requestPopulate } from "../services/requestService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS } from "../utils/constants.js";
import { moneyEquals } from "../utils/money.js";

export const listPendingAccounting = asyncHandler(async (req, res) => {
  const query = { status: REQUEST_STATUS.BUDGET_COMMITTED };
  if (req.query.period) query.accountingPeriod = req.query.period;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const supplierIds = await Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }, { normalizedIdentifier: search }] });
    query.$or = [
      { requestNumber: search },
      { description: search },
      { "supplierSnapshot.legalName": search },
      { "supplierSnapshot.identifier": search },
      { supplier: { $in: supplierIds } }
    ];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["requestNumber", "requestType", "expenseNature", "accountingPeriod", "totalPENEquivalent", "updatedAt"], { updatedAt: 1 });
  const [requests, total, summaryRows] = await Promise.all([
    FinancialRequest.find(query).populate(requestPopulate).sort(sort).skip(skip).limit(pageSize),
    FinancialRequest.countDocuments(query),
    FinancialRequest.aggregate([{ $match: query }, { $group: { _id: null, amountPEN: { $sum: "$totalPENEquivalent" } } }])
  ]);
  res.json({ ...paginatedPayload(requests.map(publicRequestPayload), total, page, pageSize), summary: { count: total, amountPEN: summaryRows[0]?.amountPEN || 0 } });
});

export const processPayable = asyncHandler(async (req, res) => {
  const result = await processAccountsPayable({ requestId: req.params.id, payload: req.body, user: req.user, req });
  await result.request.populate(requestPopulate);
  res.json({
    data: publicRequestPayload(result.request),
    accountsPayable: result.accountsPayable,
    journal: result.journal
  });
});

export const listAccountsPayable = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.currency) query.currency = req.query.currency;
  if (req.query.supplier) query.supplier = req.query.supplier;
  if (req.query.flowType) query.flowType = req.query.flowType;
  if (req.query.paymentPriority) query.paymentPriority = req.query.paymentPriority;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const [supplierIds, requestIds, batchIds] = await Promise.all([
      Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }, { normalizedIdentifier: search }] }),
      FinancialRequest.distinct("_id", { requestNumber: search }),
      PaymentBatch.distinct("_id", { batchNumber: search })
    ]);
    query.$or = [
      { supplierIdentifierSnapshot: search },
      { "voucher.voucherType": search },
      { "voucher.documentType": search },
      { "voucher.series": search },
      { "voucher.number": search },
      { supplier: { $in: supplierIds } },
      { request: { $in: requestIds } },
      { paymentBatch: { $in: batchIds } }
    ];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["dueDate", "originalAmount", "outstandingAmount", "currency", "createdAt", "status"], { createdAt: -1 });
  const [data, total, summaryRows] = await Promise.all([
    AccountsPayable.find(query)
      .populate("request", "requestNumber requestType flowType status accountingPeriod requesterArea")
      .populate("supplier", "name legalName rucDni paymentTerms")
      .populate("purchaseOrder", "poNumber originalAmount consumedAmount remainingAmount status")
      .populate("sunatVoucher", "rucIssuer voucherType series number seriesNumber xmlAmount validationStatus sunatStatus")
      .populate("sourceBatch", "batchCode status")
      .populate("provisionJournal paymentJournal")
      .populate("paymentBatch", "batchNumber bank currency paymentDate status")
      .sort(sort).skip(skip).limit(pageSize),
    AccountsPayable.countDocuments(query),
    AccountsPayable.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        originalPEN: { $sum: "$penEquivalent" },
        outstandingPEN: { $sum: { $multiply: ["$outstandingAmount", "$exchangeRate"] } },
        paidPEN: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, "$penEquivalent", 0] } }
      } }
    ])
  ]);
  res.json({
    ...paginatedPayload(data, total, page, pageSize),
    summary: { count: total, originalPEN: summaryRows[0]?.originalPEN || 0, outstandingPEN: summaryRows[0]?.outstandingPEN || 0, paidPEN: summaryRows[0]?.paidPEN || 0 }
  });
});

export const listEntries = asyncHandler(async (req, res) => {
  const journalMatch = {};
  if (req.query.period) journalMatch.period = req.query.period;
  if (req.query.type) journalMatch.entryType = req.query.type;
  const legacyMatch = {};
  if (req.query.period) legacyMatch.period = req.query.period;
  if (req.query.type) legacyMatch.type = req.query.type;
  const { page, pageSize, skip } = parsePagination(req.query);
  const pipeline = [
    { $match: journalMatch },
    { $unwind: "$lines" },
    { $project: {
      _id: { $concat: [{ $toString: "$_id" }, "-", { $toString: "$lines._id" }] },
      journalId: "$_id",
      entryNumber: 1,
      type: "$entryType",
      entryType: 1,
      request: 1,
      period: 1,
      accountNumber: "$lines.accountNumber",
      subAccount: "$lines.subAccount",
      costCenter: "$lines.costCenter",
      expenseType: "$lines.expenseType",
      description: "$lines.description",
      debit: "$lines.debit",
      credit: "$lines.credit",
      totalDebit: 1,
      totalCredit: 1,
      currency: 1,
      exchangeRate: 1,
      status: 1,
      createdAt: 1,
      legacy: { $literal: false }
    } }
  ];
  if (req.query.includeLegacy === "true") {
    pipeline.push({
      $unionWith: {
        coll: AccountingEntry.collection.name,
        pipeline: [
          { $match: legacyMatch },
          { $project: {
            _id: { $toString: "$_id" },
            journalId: "$_id",
            entryNumber: 1,
            type: 1,
            entryType: "$type",
            request: 1,
            period: 1,
            accountNumber: 1,
            subAccount: "",
            costCenter: 1,
            expenseType: 1,
            description: 1,
            debit: 1,
            credit: 1,
            totalDebit: "$debit",
            totalCredit: "$credit",
            currency: 1,
            exchangeRate: 1,
            status: 1,
            createdAt: 1,
            legacy: { $literal: true }
          } }
        ]
      }
    });
  }
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const [requestIds, costCenterIds, expenseTypeIds] = await Promise.all([
      FinancialRequest.distinct("_id", { $or: [{ requestNumber: search }, { description: search }] }),
      CostCenter.distinct("_id", { $or: [{ code: search }, { name: search }] }),
      ExpenseType.distinct("_id", { $or: [{ code: search }, { name: search }, { accountNumber: search }] })
    ]);
    pipeline.push({ $match: { $or: [
      { entryNumber: search },
      { type: search },
      { accountNumber: search },
      { description: search },
      { request: { $in: requestIds } },
      { costCenter: { $in: costCenterIds } },
      { expenseType: { $in: expenseTypeIds } }
    ] } });
  }
  const sortFields = {
    entryNumber: "entryNumber",
    type: "type",
    period: "period",
    accountNumber: "accountNumber",
    description: "description",
    debit: "debit",
    credit: "credit",
    createdAt: "createdAt"
  };
  const sortField = sortFields[req.query.sortBy] || "createdAt";
  const sortDirection = String(req.query.sortDirection).toLowerCase() === "asc" ? 1 : -1;
  const [result] = await JournalEntry.aggregate([
    ...pipeline,
    { $facet: {
      data: [{ $sort: { [sortField]: sortDirection, _id: 1 } }, { $skip: skip }, { $limit: pageSize }],
      summary: [{ $group: { _id: null, total: { $sum: 1 }, debit: { $sum: "$debit" }, credit: { $sum: "$credit" }, journals: { $addToSet: "$journalId" } } }]
    } }
  ]);
  const summary = result?.summary?.[0] || { total: 0, debit: 0, credit: 0, journals: [] };
  const data = result?.data || [];
  const requestIds = [...new Set(data.map((row) => row.request).filter(Boolean).map(String))];
  const costCenterIds = [...new Set(data.map((row) => row.costCenter).filter(Boolean).map(String))];
  const expenseTypeIds = [...new Set(data.map((row) => row.expenseType).filter(Boolean).map(String))];
  const [requests, costCenters, expenseTypes] = await Promise.all([
    FinancialRequest.find({ _id: { $in: requestIds } }).select("requestNumber requestType status"),
    CostCenter.find({ _id: { $in: costCenterIds } }),
    ExpenseType.find({ _id: { $in: expenseTypeIds } })
  ]);
  const requestMap = new Map(requests.map((item) => [String(item._id), item]));
  const costCenterMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseTypeMap = new Map(expenseTypes.map((item) => [String(item._id), item]));
  const hydrated = data.map((row) => ({
    ...row,
    request: requestMap.get(String(row.request)) || row.request,
    costCenter: costCenterMap.get(String(row.costCenter)) || row.costCenter,
    expenseType: expenseTypeMap.get(String(row.expenseType)) || row.expenseType
  }));
  res.json({
    ...paginatedPayload(hydrated, summary.total, page, pageSize),
    journalCount: summary.journals.length,
    summary: { lineCount: summary.total, journalCount: summary.journals.length, debit: summary.debit, credit: summary.credit }
  });
});

async function hydrateConsolidation(rows) {
  const costCenterIds = [...new Set(rows.map((row) => row.costCenter).filter(Boolean).map(String))];
  const expenseTypeIds = [...new Set(rows.map((row) => row.expenseType).filter(Boolean).map(String))];
  const [costCenters, expenseTypes] = await Promise.all([
    CostCenter.find({ _id: { $in: costCenterIds } }),
    ExpenseType.find({ _id: { $in: expenseTypeIds } })
  ]);
  const centerMap = new Map(costCenters.map((item) => [String(item._id), item]));
  const expenseMap = new Map(expenseTypes.map((item) => [String(item._id), item]));
  return rows.map((row) => flattenConsolidationRow(row, centerMap.get(String(row.costCenter)), expenseMap.get(String(row.expenseType))));
}

export const consolidationPreview = asyncHandler(async (req, res) => {
  if (!req.query.period) throw new AppError(400, "Period query parameter is required.", { field: "period" }, ERROR_CODES.VALIDATION_ERROR);
  const result = await getConsolidation(req.query.period);
  res.json({ data: await hydrateConsolidation(result.rows), summary: result.summary });
});

export const listAccountingExports = asyncHandler(async (req, res) => {
  const query = { kind: "CONSOLIDATION_CSV" };
  if (req.query.period) query.period = req.query.period;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ fileName: search }, { period: search }];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["createdAt", "period", "fileName", "rowCount"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    GeneratedFile.find(query).populate("generatedBy", "name email role").sort(sort).skip(skip).limit(pageSize),
    GeneratedFile.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

export const exportConsolidation = asyncHandler(async (req, res) => {
  if (!req.query.period) throw new AppError(400, "Period query parameter is required.", { field: "period" }, ERROR_CODES.VALIDATION_ERROR);
  const result = await getConsolidation(req.query.period);
  if (!moneyEquals(result.summary.difference, 0) || !result.summary.balanced) {
    throw new AppError(
      422,
      "Consolidation cannot be exported until source and centralization totals reconcile to zero difference.",
      result.summary,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  const rows = await hydrateConsolidation(result.rows);
  if ((req.query.format || "json") === "csv") {
    const content = toCsv(rows);
    const fileName = `consolidation-${req.query.period}-${Date.now()}.csv`;
    const url = await persistReportFile(fileName, content);
    await GeneratedFile.create({
      kind: "CONSOLIDATION_CSV",
      fileName,
      url,
      period: req.query.period,
      rowCount: rows.length,
      generatedBy: req.user._id,
      metadata: { reconciliation: result.summary }
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(content);
    return;
  }
  res.json({ data: rows, summary: result.summary });
});
