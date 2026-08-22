import mongoose from "mongoose";
import AccountsPayable from "../models/AccountsPayable.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import BudgetException from "../models/BudgetException.js";
import FinancialRequest from "../models/FinancialRequest.js";
import GeneratedFile from "../models/GeneratedFile.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { budgetOverview } from "../services/budgetOverviewService.js";
import { persistReportFile, toCsv } from "../services/exportService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AP_STATUS, REQUEST_STATUS, ROLES } from "../utils/constants.js";

const excludedStatuses = [REQUEST_STATUS.DRAFT, REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED];

function previousPeriod(period) {
  const date = /^\d{4}-\d{2}$/.test(period || "") ? new Date(`${period}-01T00:00:00.000Z`) : new Date();
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function areaConstraint(area) {
  return { $or: [{ requesterArea: area }, { requestingArea: area }] };
}

function requestMatch(query, user, { includeInactiveWorkflow = false } = {}) {
  const match = includeInactiveWorkflow ? {} : { status: { $nin: excludedStatuses } };
  if (query.period) match.accountingPeriod = query.period;
  if (query.currency) match.currency = query.currency;
  if (query.requestType) match.requestType = query.requestType;
  if (query.project) match.project = query.project;
  if (query.costCenter) {
    if (mongoose.isValidObjectId(query.costCenter)) match["lines.costCenter"] = new mongoose.Types.ObjectId(query.costCenter);
    else match["lines.costCenterSnapshot.code"] = query.costCenter;
  }
  if (query.dateFrom || query.dateTo) {
    match.issueDate = {};
    if (query.dateFrom) match.issueDate.$gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
    if (query.dateTo) match.issueDate.$lte = new Date(`${query.dateTo}T23:59:59.999Z`);
  }
  const constraints = [];
  if (query.area) constraints.push(areaConstraint(query.area));
  if (user?.role === ROLES.APPROVER) {
    const areas = [user.area, ...(user.approvalAreas || [])].filter(Boolean);
    if (!areas.includes("*")) constraints.push({ $or: [{ requesterArea: { $in: areas } }, { requestingArea: { $in: areas } }] });
  }
  if (constraints.length) match.$and = constraints;
  return match;
}

function prefixMatch(match, prefix) {
  return Object.fromEntries(Object.entries(match).map(([key, value]) => {
    if (["$and", "$or", "$nor"].includes(key)) return [key, value.map((item) => prefixMatch(item, prefix))];
    return [`${prefix}${key}`, value];
  }));
}

function payableRequestPipeline(match, payableMatch = {}) {
  return [
    { $match: payableMatch },
    { $lookup: { from: "financialrequests", localField: "request", foreignField: "_id", as: "requestDoc" } },
    { $unwind: "$requestDoc" },
    { $match: prefixMatch(match, "requestDoc.") }
  ];
}

function linkedRequestPipeline(match, initialMatch = {}) {
  return [
    { $match: initialMatch },
    { $lookup: { from: "financialrequests", localField: "request", foreignField: "_id", as: "requestDoc" } },
    { $unwind: "$requestDoc" },
    { $match: prefixMatch(match, "requestDoc.") }
  ];
}

export const managementSummary = asyncHandler(async (req, res) => {
  const match = requestMatch(req.query, req.user);
  const workflowMatch = requestMatch(req.query, req.user, { includeInactiveWorkflow: true });
  const selectedPeriod = req.query.period || new Date().toISOString().slice(0, 7);
  const period = req.query.period;
  const now = new Date();
  const previousQuery = { ...req.query };
  if (req.query.dateFrom && req.query.dateTo) {
    const from = new Date(`${req.query.dateFrom}T00:00:00.000Z`);
    const to = new Date(`${req.query.dateTo}T23:59:59.999Z`);
    const duration = Math.max(0, to.getTime() - from.getTime());
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - duration);
    delete previousQuery.period;
    previousQuery.dateFrom = previousFrom.toISOString().slice(0, 10);
    previousQuery.dateTo = previousTo.toISOString().slice(0, 10);
  } else {
    previousQuery.period = previousPeriod(selectedPeriod);
    delete previousQuery.dateFrom;
    delete previousQuery.dateTo;
  }
  const previousMatch = requestMatch(previousQuery, req.user);
  const openPayableStatuses = [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED];
  const budgetFilters = {
    ...(period ? { period } : {}),
    ...(req.query.costCenter && mongoose.isValidObjectId(req.query.costCenter) ? { costCenter: req.query.costCenter } : {}),
    ...(req.query.project ? { project: req.query.project } : {}),
    ...(req.query.area ? { area: req.query.area } : {})
  };

  const [
    byType,
    byMonth,
    byYear,
    byArea,
    byProject,
    byCostCenter,
    byAccount,
    payable,
    payableAgeing,
    paymentComparison,
    treasurySchedule,
    approvalTiming,
    approvalSla,
    observed,
    accounting,
    bankFiles,
    commitments,
    commitmentAnalysis,
    budgetExceptionAnalysis,
    supplierConcentration,
    renditionAnalysis,
    statusFunnel,
    reconciliationStatus,
    comparisonTotals,
    optionRows,
    openPayableCount,
    budget
  ] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$requestType", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$accountingPeriod", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: { $toString: { $year: "$issueDate" } }, total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] }, total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    FinancialRequest.aggregate([{ $match: { ...match, project: { $nin: [null, ""] } } }, { $group: { _id: "$project", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    FinancialRequest.aggregate([{ $match: match }, { $unwind: "$lines" }, { $group: { _id: { id: "$lines.costCenter", code: "$lines.costCenterSnapshot.code", name: "$lines.costCenterSnapshot.name" }, total: { $sum: "$lines.penEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    FinancialRequest.aggregate([{ $match: match }, { $unwind: "$lines" }, { $group: { _id: { id: "$lines.expenseType", code: "$lines.expenseTypeSnapshot.accountNumber", name: "$lines.expenseTypeSnapshot.name" }, total: { $sum: "$lines.penEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 20 }]),
    AccountsPayable.aggregate([
      ...payableRequestPipeline(match),
      { $group: { _id: "$status", original: { $sum: "$penEquivalent" }, outstanding: { $sum: { $multiply: ["$outstandingAmount", "$exchangeRate"] } }, count: { $sum: 1 } } }
    ]),
    AccountsPayable.aggregate([
      ...payableRequestPipeline(match, { status: { $in: openPayableStatuses } }),
      { $project: { amount: { $multiply: ["$outstandingAmount", "$exchangeRate"] }, daysOverdue: { $floor: { $divide: [{ $subtract: [now, { $ifNull: ["$dueDate", "$createdAt"] }] }, 86400000] } } } },
      { $project: { amount: 1, bucket: { $switch: { branches: [
        { case: { $lte: ["$daysOverdue", 0] }, then: { label: "Current", order: 0 } },
        { case: { $lte: ["$daysOverdue", 30] }, then: { label: "1-30 days", order: 1 } },
        { case: { $lte: ["$daysOverdue", 60] }, then: { label: "31-60 days", order: 2 } },
        { case: { $lte: ["$daysOverdue", 90] }, then: { label: "61-90 days", order: 3 } }
      ], default: { label: "90+ days", order: 4 } } } } },
      { $group: { _id: "$bucket.label", order: { $first: "$bucket.order" }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { order: 1 } }
    ]),
    AccountsPayable.aggregate([
      ...payableRequestPipeline(match, { status: { $ne: AP_STATUS.CANCELLED } }),
      { $project: { amount: { $cond: [{ $eq: ["$status", AP_STATUS.PAID] }, "$penEquivalent", { $multiply: ["$outstandingAmount", "$exchangeRate"] }] }, category: { $switch: { branches: [
        { case: { $eq: ["$status", AP_STATUS.PAID] }, then: "Paid" },
        { case: { $and: [{ $lt: ["$dueDate", now] }, { $in: ["$status", openPayableStatuses] }] }, then: "Overdue" }
      ], default: "Pending" } } } },
      { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]),
    AccountsPayable.aggregate([
      ...payableRequestPipeline(match, { status: { $in: openPayableStatuses } }),
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $ifNull: ["$dueDate", "$createdAt"] } } }, total: { $sum: { $multiply: ["$outstandingAmount", "$exchangeRate"] } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 14 }
    ]),
    FinancialRequest.aggregate([
      { $match: match },
      { $unwind: "$approvalHistory" },
      { $match: { "approvalHistory.startedAt": { $type: "date" }, "approvalHistory.completedAt": { $type: "date" } } },
      { $group: { _id: "$requesterArea", averageHours: { $avg: { $divide: [{ $subtract: ["$approvalHistory.completedAt", "$approvalHistory.startedAt"] }, 3600000] } }, decisions: { $sum: 1 } } }
    ]),
    FinancialRequest.aggregate([
      { $match: match },
      { $unwind: "$approvalHistory" },
      { $match: { "approvalHistory.slaResult": { $in: ["ON_TIME", "OVERDUE"] } } },
      { $group: { _id: "$approvalHistory.slaResult", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    FinancialRequest.aggregate([{ $match: { ...match, status: { $in: [REQUEST_STATUS.OBSERVED, REQUEST_STATUS.RETURNED] } } }, { $group: { _id: "$requesterArea", count: { $sum: 1 }, amount: { $sum: "$totalPENEquivalent" } } }]),
    JournalEntry.aggregate([{ $match: { ...(period ? { period } : {}), status: "POSTED" } }, { $group: { _id: "$entryType", debit: { $sum: "$totalDebit" }, credit: { $sum: "$totalCredit" }, count: { $sum: 1 } } }]),
    PaymentBatch.find(period ? { paymentDate: { $gte: new Date(`${period}-01T00:00:00.000Z`), $lt: new Date(new Date(`${period}-01T00:00:00.000Z`).setUTCMonth(new Date(`${period}-01T00:00:00.000Z`).getUTCMonth() + 1)) } } : {}).select("-filePath").populate("generatedBy", "name role").sort({ generatedAt: -1 }).limit(50),
    BudgetCommitment.find(period ? { period } : {}).populate("request", "requestNumber requestType status project requesterArea").sort({ createdAt: -1 }).limit(100),
    BudgetCommitment.aggregate([...linkedRequestPipeline(match, period ? { period } : {}), { $group: { _id: "$status", total: { $sum: "$totalAmount" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    BudgetException.aggregate([...linkedRequestPipeline(match), { $group: { _id: { status: "$status", strategy: "$strategy" }, requested: { $sum: "$requestedAmount" }, available: { $sum: "$availableAmount" }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$supplier", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 10 }, { $lookup: { from: "suppliers", localField: "_id", foreignField: "_id", as: "supplier" } }, { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } }, { $project: { _id: 1, total: 1, count: 1, name: { $ifNull: ["$supplier.legalName", "$supplier.name"] }, identifier: { $ifNull: ["$supplier.normalizedIdentifier", "$supplier.rucDni"] } } }]),
    FinancialRequest.aggregate([{ $match: { ...match, status: REQUEST_STATUS.RENDITION_PENDING } }, { $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] }, total: { $sum: "$totalPENEquivalent" }, outstanding: { $sum: "$rendition.balanceOutstanding" }, count: { $sum: 1 } } }, { $sort: { outstanding: -1 } }]),
    FinancialRequest.aggregate([{ $match: workflowMatch }, { $group: { _id: "$status", total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }]),
    FinancialRequest.aggregate([{ $match: { ...match, status: { $in: [REQUEST_STATUS.PAID, REQUEST_STATUS.RECONCILED, REQUEST_STATUS.CLOSED] } } }, { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$totalPENEquivalent" } } }]),
    Promise.all([
      FinancialRequest.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }]),
      FinancialRequest.aggregate([{ $match: previousMatch }, { $group: { _id: null, total: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }])
    ]),
    FinancialRequest.aggregate([
      { $match: requestMatch({}, req.user) },
      { $facet: {
        areas: [{ $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] } } }, { $match: { _id: { $nin: [null, ""] } } }, { $sort: { _id: 1 } }],
        projects: [{ $match: { project: { $nin: [null, ""] } } }, { $group: { _id: "$project" } }, { $sort: { _id: 1 } }],
        costCenters: [{ $unwind: "$lines" }, { $group: { _id: "$lines.costCenter", code: { $first: "$lines.costCenterSnapshot.code" }, name: { $first: "$lines.costCenterSnapshot.name" } } }, { $sort: { code: 1 } }]
      } }
    ]),
    AccountsPayable.aggregate([...payableRequestPipeline(match, { status: { $in: openPayableStatuses } }), { $count: "count" }]),
    budgetOverview(budgetFilters)
  ]);
  const overduePayables = await AccountsPayable.countDocuments({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED] }, dueDate: { $lt: now } });
  const overdueApprovals = await FinancialRequest.countDocuments({ ...match, status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] }, approvalDueAt: { $lt: now } });
  const exports = await GeneratedFile.find({ kind: "MANAGEMENT_CSV" }).populate("generatedBy", "name role").sort({ createdAt: -1 }).limit(50);
  const [periodRecord, pendingFiscal, pendingRenditions, missingFx, unbalancedJournals, paidAwaitingReconciliation] = await Promise.all([
    AccountingPeriod.findOne({ period: selectedPeriod }).select("period status closingDate updatedAt").lean(),
    FinancialRequest.countDocuments({ ...match, accountingPeriod: selectedPeriod, status: REQUEST_STATUS.BUDGET_COMMITTED }),
    FinancialRequest.countDocuments({ ...match, accountingPeriod: selectedPeriod, status: REQUEST_STATUS.RENDITION_PENDING }),
    FinancialRequest.countDocuments({ ...match, accountingPeriod: selectedPeriod, currency: "USD", $or: [{ exchangeRateDate: null }, { exchangeRate: { $lte: 0 } }] }),
    JournalEntry.countDocuments({ period: selectedPeriod, status: "POSTED", $expr: { $ne: ["$totalDebit", "$totalCredit"] } }),
    FinancialRequest.countDocuments({ ...match, accountingPeriod: selectedPeriod, status: REQUEST_STATUS.PAID })
  ]);
  const currentComparison = comparisonTotals[0][0] || { total: 0, count: 0 };
  const priorComparison = comparisonTotals[1][0] || { total: 0, count: 0 };
  const options = optionRows[0] || { areas: [], projects: [], costCenters: [] };
  const closeBlockers = {
    pendingFiscal,
    openPayables: openPayableCount[0]?.count || 0,
    paidAwaitingReconciliation,
    pendingRenditions,
    missingExchangeRates: missingFx,
    unbalancedJournals
  };
  res.json({ data: {
    byType,
    byMonth,
    byYear,
    byArea,
    byProject,
    byCostCenter,
    byAccount,
    payable,
    payableAgeing,
    paymentComparison,
    treasurySchedule,
    approvalTiming,
    approvalSla,
    observed,
    accounting,
    bankFiles,
    commitments,
    commitmentAnalysis,
    budgetExceptionAnalysis,
    supplierConcentration,
    renditionAnalysis,
    statusFunnel,
    reconciliationStatus,
    budget: budget.totals,
    budgetAllocations: budget.allocations,
    budgetWarnings: budget.warnings,
    overdueApprovals,
    overduePayables,
    comparison: {
      currentPeriod: selectedPeriod,
      previousPeriod: previousQuery.period || `${previousQuery.dateFrom} - ${previousQuery.dateTo}`,
      currentTotal: currentComparison.total,
      previousTotal: priorComparison.total,
      currentCount: currentComparison.count,
      previousCount: priorComparison.count,
      changePercent: priorComparison.total ? ((currentComparison.total - priorComparison.total) / priorComparison.total) * 100 : null
    },
    periodClose: {
      period: selectedPeriod,
      status: periodRecord?.status || "NOT_CREATED",
      blockers: closeBlockers,
      ready: periodRecord?.status === "OPEN" && Object.values(closeBlockers).every((value) => Number(value || 0) === 0)
    },
    filterOptions: {
      areas: options.areas.map((item) => item._id),
      projects: options.projects.map((item) => item._id),
      costCenters: options.costCenters.map((item) => ({ value: item._id, code: item.code, name: item.name }))
    },
    exports,
    lastUpdated: new Date().toISOString()
  } });
});

export const exportManagementReport = asyncHandler(async (req, res) => {
  const requests = await FinancialRequest.find(requestMatch(req.query, req.user)).populate("supplier", "rucDni normalizedIdentifier name legalName").populate("requester", "name area").sort({ createdAt: -1 });
  const rows = requests.map((request) => ({
    requestNumber: request.requestNumber,
    type: request.requestType,
    expenseNature: request.expenseNature,
    area: request.requesterArea || request.requestingArea || request.requester?.area || "",
    project: request.project || "",
    supplierRucDni: request.supplierSnapshot?.identifier || request.supplier?.normalizedIdentifier || request.supplier?.rucDni || "",
    supplier: request.supplierSnapshot?.legalName || request.supplier?.legalName || request.supplier?.name || "",
    period: request.accountingPeriod,
    status: request.status,
    currency: request.currency,
    originalAmount: request.totalAmount,
    exchangeRate: request.exchangeRate,
    penEquivalent: request.totalPENEquivalent
  }));
  const content = toCsv(rows);
  const fileName = `management-report-${req.query.period || "all"}-${Date.now()}.csv`;
  const url = await persistReportFile(fileName, content);
  await GeneratedFile.create({ kind: "MANAGEMENT_CSV", fileName, url, period: req.query.period, requestNumbers: rows.map((row) => row.requestNumber), rowCount: rows.length, generatedBy: req.user._id, metadata: { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, currency: req.query.currency, requestType: req.query.requestType, area: req.query.area, costCenter: req.query.costCenter, project: req.query.project } });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  res.send(content);
});

export const listManagementExports = asyncHandler(async (req, res) => {
  const query = { kind: "MANAGEMENT_CSV" };
  if (req.query.period) query.period = req.query.period;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ fileName: search }, { period: search }, { requestNumbers: search }];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["createdAt", "period", "fileName", "rowCount"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    GeneratedFile.find(query).populate("generatedBy", "name role").sort(sort).skip(skip).limit(pageSize),
    GeneratedFile.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});
