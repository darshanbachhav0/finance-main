import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { budgetAllocationRows } from "./budgetReportingService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES, REQUEST_STATUS } from "../utils/constants.js";
import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";

const terminalStatuses = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED, "PAGADO_CERRADO", "LIQUIDADO_CERRADO"];
const approvalStatuses = [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED];
const observedStatuses = [REQUEST_STATUS.OBSERVED, REQUEST_STATUS.OBSERVED_BUDGET, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, REQUEST_STATUS.OBSERVED_BATCH, REQUEST_STATUS.RETURNED];
const openPayableStatuses = [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PAYMENT_BOUNCED];
const cache = new Map();

const forbiddenPayloadKeys = new Set([
  "_id", "id", "request", "requestid", "requestnumber", "supplier", "supplierid", "suppliername",
  "ruc", "dni", "email", "employee", "account", "accountnumber", "cci", "filename", "filehash",
  "url", "comments", "description", "title", "actor", "userid", "voucher", "invoice"
]);

function number(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateOnly(value, field) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new AppError(422, `${field} must use YYYY-MM-DD.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== String(value)) throw new AppError(422, `${field} is invalid.`, { field }, ERROR_CODES.VALIDATION_ERROR);
  return date;
}

export function parseManagementFilters(query = {}) {
  const period = query.period ? String(query.period).trim() : "";
  if (period && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(period)) {
    throw new AppError(422, "period must use YYYY or YYYY-MM.", { field: "period" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const area = query.area ? String(query.area).trim() : "";
  if (area.length > 120 || /[$\u0000-\u001f]/.test(area)) {
    throw new AppError(422, "area is invalid.", { field: "area" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const dateFrom = dateOnly(query.dateFrom, "dateFrom");
  const dateTo = dateOnly(query.dateTo, "dateTo");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError(422, "dateFrom must be on or before dateTo.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  return { period, area, dateFrom: dateFrom?.toISOString().slice(0, 10) || "", dateTo: dateTo?.toISOString().slice(0, 10) || "" };
}

function requestMatch(filters, prefix = "") {
  const match = {};
  if (filters.period) match[`${prefix}accountingPeriod`] = filters.period.length === 4 ? new RegExp(`^${filters.period}-`) : filters.period;
  if (filters.area) match.$or = [{ [`${prefix}requesterArea`]: filters.area }, { [`${prefix}requestingArea`]: filters.area }];
  if (filters.dateFrom || filters.dateTo) {
    match[`${prefix}issueDate`] = {};
    if (filters.dateFrom) match[`${prefix}issueDate`].$gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) match[`${prefix}issueDate`].$lt = new Date(new Date(`${filters.dateTo}T00:00:00.000Z`).getTime() + 86400000);
  }
  return match;
}

function payablePipeline(filters, stages) {
  return [
    { $lookup: { from: "financialrequests", localField: "request", foreignField: "_id", as: "requestScope" } },
    { $unwind: "$requestScope" },
    { $match: requestMatch(filters, "requestScope.") },
    ...stages
  ];
}

function grouped(rows, canonical = false) {
  const result = new Map();
  for (const row of rows || []) {
    const key = canonical ? canonicalRequestStatus(row._id) : (row._id || "UNASSIGNED");
    const current = result.get(key) || { key, count: 0, amountPEN: 0 };
    current.count += Number(row.count || 0);
    current.amountPEN = number(current.amountPEN + Number(row.amountPEN || 0));
    result.set(key, current);
  }
  return [...result.values()].sort((a, b) => b.amountPEN - a.amountPEN || b.count - a.count);
}

async function overview(filters) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const match = requestMatch(filters);
  const [requestRows, payableRows, overdueApprovals, observedRequests, paidThisMonth, budgetRows] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } }]),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $group: { _id: "$status", count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }])),
    FinancialRequest.countDocuments({ ...match, status: { $in: approvalStatuses }, approvalDueAt: { $lt: now } }),
    FinancialRequest.countDocuments({ ...match, status: { $in: observedStatuses } }),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $match: { status: AP_STATUS.PAID, paidDate: { $gte: monthStart } } }, { $group: { _id: null, count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }])),
    budgetAllocationRows({ period: filters.period })
  ]);
  const requestSummary = grouped(requestRows, true);
  const payableSummary = grouped(payableRows);
  const requestCount = (statuses) => requestSummary.filter((row) => statuses.includes(row.key)).reduce((sum, row) => sum + row.count, 0);
  const payableAmount = (statuses) => payableSummary.filter((row) => statuses.includes(row.key)).reduce((sum, row) => sum + row.amountPEN, 0);
  const scopedBudget = budgetRows.filter((row) => !filters.area || row.costCenter?.area === filters.area).filter((row) => !["UNDATED_LEGACY", "ANNUAL_FALLBACK"].includes(row.reportingScope));
  const budget = scopedBudget.reduce((total, row) => ({
    assignedPEN: number(total.assignedPEN + Number(row.assignedAmount || 0)),
    committedPEN: number(total.committedPEN + Number(row.committedAmount || 0)),
    availablePEN: number(total.availablePEN + Number(row.availableAmount || 0))
  }), { assignedPEN: 0, committedPEN: 0, availablePEN: 0 });
  return {
    pendingRequests: requestSummary.filter((row) => !terminalStatuses.map(canonicalRequestStatus).includes(row.key) && row.key !== REQUEST_STATUS.DRAFT).reduce((sum, row) => sum + row.count, 0),
    pendingApprovals: requestCount(approvalStatuses),
    observedRequests,
    overdueApprovals,
    pendingPayments: payableSummary.filter((row) => openPayableStatuses.includes(row.key)).reduce((sum, row) => sum + row.count, 0),
    pendingPaymentAmountPEN: number(payableAmount(openPayableStatuses)),
    paidThisMonth: { count: paidThisMonth[0]?.count || 0, amountPEN: number(paidThisMonth[0]?.amountPEN) },
    closedRequests: requestCount([REQUEST_STATUS.CLOSED]),
    budget
  };
}

async function budget(filters) {
  const rows = (await budgetAllocationRows({ period: filters.period })).filter((row) => !filters.area || row.costCenter?.area === filters.area);
  const reportable = rows.filter((row) => !["UNDATED_LEGACY", "ANNUAL_FALLBACK"].includes(row.reportingScope));
  const totals = reportable.reduce((result, row) => ({
    assignedPEN: number(result.assignedPEN + Number(row.assignedAmount || 0)),
    committedPEN: number(result.committedPEN + Number(row.committedAmount || 0)),
    executedPEN: number(result.executedPEN + Number(row.executedAmount || 0)),
    paidPEN: number(result.paidPEN + Number(row.paidAmount || 0)),
    availablePEN: number(result.availablePEN + Number(row.availableAmount || 0))
  }), { assignedPEN: 0, committedPEN: 0, executedPEN: 0, paidPEN: 0, availablePEN: 0 });
  return {
    totals,
    utilizationPercent: totals.assignedPEN ? number(((totals.committedPEN + totals.executedPEN) / totals.assignedPEN) * 100) : 0,
    allocationCount: reportable.length,
    lowBalanceCount: reportable.filter((row) => row.assignedAmount > 0 && row.availableAmount / row.assignedAmount < 0.1).length,
    overExecutedCount: reportable.filter((row) => row.availableAmount < 0).length
  };
}

async function workflow(filters) {
  const match = requestMatch(filters);
  const [byStatus, byFlow, byPeriod, byArea, rendition] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$flowType", count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: "$accountingPeriod", count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } }, { $sort: { _id: 1 } }]),
    FinancialRequest.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] }, count: { $sum: 1 }, amountPEN: { $sum: "$totalPENEquivalent" } } }, { $sort: { amountPEN: -1 } }]),
    FinancialRequest.aggregate([{ $match: { ...match, flowType: "C", "rendition.status": { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }, status: { $nin: terminalStatuses } } }, { $group: { _id: "$rendition.status", count: { $sum: 1 }, amountPEN: { $sum: "$rendition.balanceOutstanding" } } }])
  ]);
  return { byStatus: grouped(byStatus, true), byFlow: grouped(byFlow), byPeriod: grouped(byPeriod).sort((a, b) => String(a.key).localeCompare(String(b.key))), byArea: grouped(byArea), rendition: grouped(rendition) };
}

async function payments(filters) {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 86400000);
  const [byStatus, schedule, paidByMonth, reconciliation, ageing] = await Promise.all([
    AccountsPayable.aggregate(payablePipeline(filters, [{ $group: { _id: "$status", count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }])),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $match: { status: { $in: openPayableStatuses }, scheduledFor: { $gte: now, $lte: inSevenDays } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$scheduledFor" } }, count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }, { $sort: { _id: 1 } }])),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $match: { status: AP_STATUS.PAID, paidDate: { $ne: null } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidDate" } }, count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }, { $sort: { _id: -1 } }, { $limit: 24 }])),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $match: { status: AP_STATUS.PAID } }, { $group: { _id: { $cond: [{ $ne: [{ $ifNull: ["$reconciliation", null] }, null] }, "RECONCILED", "PENDING"] }, count: { $sum: 1 }, amountPEN: { $sum: "$penEquivalent" } } }])),
    AccountsPayable.aggregate(payablePipeline(filters, [{ $match: { status: { $in: openPayableStatuses } } }, { $project: { amountPEN: "$penEquivalent", bucket: { $switch: { branches: [
      { case: { $eq: [{ $ifNull: ["$dueDate", null] }, null] }, then: "NO_DUE_DATE" },
      { case: { $gte: ["$dueDate", now] }, then: "CURRENT" },
      { case: { $gte: ["$dueDate", new Date(now.getTime() - 30 * 86400000)] }, then: "1_30_DAYS" },
      { case: { $gte: ["$dueDate", new Date(now.getTime() - 60 * 86400000)] }, then: "31_60_DAYS" }
    ], default: "OVER_60_DAYS" } } } }, { $group: { _id: "$bucket", count: { $sum: 1 }, amountPEN: { $sum: "$amountPEN" } } }]))
  ]);
  return { byStatus: grouped(byStatus), nextSevenDays: grouped(schedule).sort((a, b) => String(a.key).localeCompare(String(b.key))), paidByMonth: grouped(paidByMonth).sort((a, b) => String(a.key).localeCompare(String(b.key))), reconciliation: grouped(reconciliation), ageing: grouped(ageing) };
}

async function sla(filters) {
  const match = requestMatch(filters);
  const now = new Date();
  const escalationHours = Math.max(1, Number(process.env.SLA_ESCALATION_HOURS || 24));
  const longOverdue = new Date(now.getTime() - escalationHours * 3600000);
  const [completed, timing, current] = await Promise.all([
    FinancialRequest.aggregate([{ $match: match }, { $unwind: "$approvalHistory" }, { $match: { "approvalHistory.completedAt": { $ne: null }, "approvalHistory.slaResult": { $in: ["ON_TIME", "OVERDUE"] } } }, { $group: { _id: "$approvalHistory.slaResult", count: { $sum: 1 } } }]),
    FinancialRequest.aggregate([{ $match: match }, { $unwind: "$approvalHistory" }, { $match: { "approvalHistory.startedAt": { $ne: null }, "approvalHistory.completedAt": { $ne: null } } }, { $group: { _id: { $ifNull: ["$requesterArea", "$requestingArea"] }, count: { $sum: 1 }, averageHours: { $avg: { $divide: [{ $subtract: ["$approvalHistory.completedAt", "$approvalHistory.startedAt"] }, 3600000] } } } }, { $sort: { averageHours: -1 } }]),
    FinancialRequest.aggregate([{ $match: { ...match, status: { $in: approvalStatuses }, approvalDueAt: { $ne: null } } }, { $project: { bucket: { $switch: { branches: [
      { case: { $lt: ["$approvalDueAt", longOverdue] }, then: "LONG_OVERDUE" },
      { case: { $lt: ["$approvalDueAt", now] }, then: "OVERDUE" }
    ], default: "ON_TRACK" } } } }, { $group: { _id: "$bucket", count: { $sum: 1 } } }])
  ]);
  return {
    completed: grouped(completed).map(({ key, count }) => ({ key, count })),
    averageHoursByArea: (timing || []).map((row) => ({ key: row._id || "UNASSIGNED", count: row.count, averageHours: number(row.averageHours) })),
    current: grouped(current).map(({ key, count }) => ({ key, count }))
  };
}

async function filters() {
  const [periods, requesterAreas, requestingAreas] = await Promise.all([
    FinancialRequest.distinct("accountingPeriod"),
    FinancialRequest.distinct("requesterArea"),
    FinancialRequest.distinct("requestingArea")
  ]);
  return {
    periods: periods.filter(Boolean).sort().reverse().slice(0, 60),
    areas: [...new Set([...requesterAreas, ...requestingAreas].filter(Boolean))].sort()
  };
}

const builders = { overview, budget, workflow, payments, sla, filters };

export function assertSafeManagementPayload(value, path = "payload") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeManagementPayload(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(key.toLowerCase())) throw new Error(`Unsafe management API field: ${path}.${key}`);
    assertSafeManagementPayload(child, `${path}.${key}`);
  }
}

export function managementEnvelope(data, appliedFilters = {}, asOf = new Date()) {
  assertSafeManagementPayload(data);
  return { apiVersion: "1.0", asOf: asOf.toISOString(), currency: "PEN", appliedFilters, data };
}

export async function managementSnapshot(section, rawFilters = {}) {
  const builder = builders[section];
  if (!builder) throw new AppError(404, "Management API section not found.", { section }, ERROR_CODES.NOT_FOUND);
  const parsed = section === "filters" ? { period: "", area: "", dateFrom: "", dateTo: "" } : parseManagementFilters(rawFilters);
  const key = `${section}:${JSON.stringify(parsed)}`;
  const ttlSeconds = Math.max(1, Math.min(300, Number(process.env.MANAGEMENT_API_CACHE_SECONDS || 15)));
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.payload, freshnessSeconds: Math.floor((Date.now() - cached.createdAt) / 1000) };
  const payload = managementEnvelope(await builder(parsed), parsed);
  cache.set(key, { payload, createdAt: Date.now(), expiresAt: Date.now() + ttlSeconds * 1000 });
  return { ...payload, freshnessSeconds: 0 };
}

export function clearManagementApiCache() {
  cache.clear();
}
