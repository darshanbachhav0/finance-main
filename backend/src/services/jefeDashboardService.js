import User from "../models/User.js";
import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import AccountsPayable from "../models/AccountsPayable.js";
import { budgetOverview } from "./budgetReportingService.js";
import { listApprovalInbox } from "./approvalService.js";
import { requestVisibilityFilter } from "../utils/permissions.js";
import { ROLES, AP_STATUS } from "../utils/constants.js";
import { limaToday } from "../../../shared/businessCalendar.mjs";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginatedPayload } from "./queryService.js";

export async function isJefe(user) {
  if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR].includes(user.role)) return true;
  if (user.role !== ROLES.SOLICITOR) return false;
  return Boolean(await User.exists({ $or: [{ jefe: user._id }, { substitute: user._id }] })
    || await FinancialRequest.exists({ approvalRouteSnapshot: { $elemMatch: { approverUser: user._id, status: "PENDING", source: "MANAGER_CHAIN" } } }));
}

// Finance fields in this dashboard never inherit institution-wide request-view permissions.
export function departmentScope(user) {
  const areas = [...new Set([user.area, ...(user.approvalAreas || [])].filter(area => area && area !== "*" && area.trim().toUpperCase() !== "GENERAL"))];
  return areas.length ? { area: { $in: areas } } : { _id: null };
}

async function departmentRequests(user) {
  const areas = departmentScope(user).area?.$in || [];
  return FinancialRequest.distinct("_id", { $and: [requestVisibilityFilter(user), {
    $or: [{ requesterArea: { $in: areas } }, { requestingArea: { $in: areas } }]
  }] });
}

// Shared pipeline powers both the alert and its filtered list. Date-only UTC records keep
// their commercial day; timed dates use Lima, just like the application date formatter.
export function invoiceStateStage(now = new Date()) {
  const today = limaToday(now);
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 7);
  const due = { $dateToString: { date: "$dueDate", format: "%Y-%m-%d", onNull: "", timezone: {
    $cond: [{ $eq: [{ $mod: [{ $toLong: { $ifNull: ["$dueDate", new Date(0)] } }, 86400000] }, 0] }, "UTC", "America/Lima"]
  } } };
  return { $set: { invoiceState: { $switch: { branches: [
    { case: { $eq: ["$status", AP_STATUS.PAID] }, then: "Pagada" },
    { case: { $and: [{ $gt: ["$outstandingAmount", 0] }, { $ne: [due, ""] }, { $lt: [due, today] }] }, then: "Vencida" },
    { case: { $and: [{ $gt: ["$outstandingAmount", 0] }, { $ne: [due, ""] }, { $lte: [due, limit.toISOString().slice(0, 10)] }] }, then: "Por vencer" }
  ], default: "Pendiente" } } } };
}

async function invoicePipeline(user) {
  const requestIds = await departmentRequests(user);
  return [ { $match: { request: { $in: requestIds }, status: { $ne: AP_STATUS.CANCELLED }, flowType: { $ne: "C" }, "voucher.number": { $exists: true, $ne: "" } } }, invoiceStateStage() ];
}

export async function jefeDashboard(user) {
  const year = limaToday().slice(0, 4);
  const centers = await CostCenter.distinct("_id", { active: true, ...departmentScope(user) });
  const [budget, approvals, pipeline] = await Promise.all([
    budgetOverview({ period: year, costCenter: { $in: centers }, summaryOnly: true }),
    listApprovalInbox({ page: 1, pageSize: 5 }, user),
    invoicePipeline(user)
  ]);
  const counts = await AccountsPayable.aggregate([...pipeline, { $group: { _id: "$invoiceState", count: { $sum: 1 } } }]);
  const configured = budget.allocations.length > 0 && !budget.hasUndatedLegacy;
  return { year, configured, totals: configured ? budget.totals : null,
    progress: configured && budget.totals.assigned > 0 ? Math.round(budget.totals.executed / budget.totals.assigned * 1000) / 10 : null,
    approvals: approvals.data, approvalCount: approvals.pagination?.total || 0,
    invoiceAlerts: { overdue: counts.find(row => row._id === "Vencida")?.count || 0, dueSoon: counts.find(row => row._id === "Por vencer")?.count || 0 } };
}

export async function jefeInvoices(user, query = {}) {
  if (!await isJefe(user)) throw new AppError(403, "This view is reserved for department approvers.");
  const pipeline = await invoicePipeline(user);
  if (query.state === "due") pipeline.push({ $match: { invoiceState: { $in: ["Por vencer", "Vencida"] } } });
  else if (["Pendiente", "Por vencer", "Vencida", "Pagada"].includes(query.state)) pipeline.push({ $match: { invoiceState: query.state } });
  const { page, pageSize, skip } = parsePagination(query);
  const [result] = await AccountsPayable.aggregate([...pipeline, { $facet: {
    total: [{ $count: "count" }],
    data: [{ $sort: { dueDate: 1, _id: 1 } }, { $skip: skip }, { $limit: pageSize }, { $project: {
      request: 1, supplier: 1, voucher: 1, originalAmount: 1, currency: 1, outstandingAmount: 1, dueDate: 1, invoiceState: 1,
      "paymentTermsSnapshot.days": 1, "paymentTermsSnapshot.option": 1, "paymentTermsSnapshot.creditDays": 1, scheduledFor: 1, plannedPaymentDate: 1, paidDate: 1
    } }]
  } }]);
  const data = await AccountsPayable.populate(result?.data || [], [{ path: "supplier", select: "name legalName" }, { path: "request", select: "requestNumber" }]);
  return paginatedPayload(data, result?.total[0]?.count || 0, page, pageSize);
}

