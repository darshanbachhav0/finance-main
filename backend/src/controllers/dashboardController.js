import AccountsPayable from "../models/AccountsPayable.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import AuditLog from "../models/AuditLog.js";
import BudgetException from "../models/BudgetException.js";
import ExchangeRate from "../models/ExchangeRate.js";
import FinancialRequest from "../models/FinancialRequest.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { budgetOverview } from "../services/budgetOverviewService.js";
import { APPROVAL_STAGES, AP_STATUS, REQUEST_STATUS, ROLES } from "../utils/constants.js";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function ownerScope(user) {
  return user.role === ROLES.SOLICITOR ? { $or: [{ requester: user._id }, { solicitor: user._id }] } : {};
}

function approvalScope(user) {
  const query = { status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] } };
  if (user.role !== ROLES.ADMIN) {
    query.approvalStage = user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR;
    if (query.approvalStage === APPROVAL_STAGES.AREA_DIRECTOR) {
      const areas = [user.area, ...(user.approvalAreas || [])].filter(Boolean);
      if (!areas.includes("*")) query.$or = [{ requesterArea: { $in: areas } }, { requestingArea: { $in: areas } }];
    }
  }
  return query;
}

async function missingExchangeRateDates() {
  const requests = await FinancialRequest.find({ currency: "USD", status: { $nin: [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED] } }).select("issueDate").lean();
  const dates = [...new Set(requests.map((request) => new Date(request.issueDate).toISOString().slice(0, 10)))];
  if (!dates.length) return [];
  const configured = await ExchangeRate.find({ active: true, date: { $in: dates.map((value) => new Date(`${value}T00:00:00.000Z`)) } }).select("date").lean();
  const available = new Set(configured.map((item) => item.date.toISOString().slice(0, 10)));
  return dates.filter((date) => !available.has(date)).sort();
}

async function buildTasks(user) {
  const items = [];
  if ([ROLES.ADMIN, ROLES.APPROVER, ROLES.MANAGEMENT].includes(user.role)) {
    const query = approvalScope(user);
    const [count, overdue] = await Promise.all([
      FinancialRequest.countDocuments(query),
      FinancialRequest.countDocuments({ ...query, approvalDueAt: { $lt: new Date() } })
    ]);
    items.push({ key: "approval", label: "Requests awaiting approval", count, path: "/approvals", tone: "amber" });
    items.push({ key: "approvalOverdue", label: "Approval SLA overdue", count: overdue, path: "/approvals", tone: "red" });
  }
  if ([ROLES.ADMIN, ROLES.TREASURY].includes(user.role)) {
    const payable = await AccountsPayable.countDocuments({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED] } });
    const confirmation = await AccountsPayable.countDocuments({ status: AP_STATUS.PAYMENT_FILE_CREATED });
    items.push({ key: "payable", label: "CXP ready for Treasury", count: payable, path: "/treasury", tone: "teal" });
    items.push({ key: "paymentConfirmation", label: "Payments awaiting confirmation", count: confirmation, path: "/treasury", tone: "amber" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SOLICITOR].includes(user.role)) {
    const query = { status: REQUEST_STATUS.RENDITION_PENDING };
    if (user.role === ROLES.SOLICITOR) query.$or = [{ requester: user._id }, { solicitor: user._id }];
    items.push({ key: "rendition", label: "Renditions outstanding", count: await FinancialRequest.countDocuments(query), path: "/requests?status=RENDICION_PENDIENTE", tone: "amber" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) {
    items.push({ key: "accounting", label: "Requests awaiting fiscal processing", count: await FinancialRequest.countDocuments({ status: REQUEST_STATUS.BUDGET_COMMITTED }), path: "/accounting", tone: "teal" });
    items.push({ key: "suppliers", label: "Suppliers awaiting homologation", count: await Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION" }), path: "/suppliers", tone: "amber" });
    const missingDates = await missingExchangeRateDates();
    items.push({ key: "missingExchangeRate", label: "Missing exchange-rate dates", count: missingDates.length, details: missingDates, path: "/exchange-rates", tone: "red" });
    const period = await AccountingPeriod.findOne({ period: currentPeriod() });
    items.push({ key: "period", label: period?.status === "OPEN" ? "Current accounting period open" : "Current accounting period unavailable", count: period?.status === "OPEN" ? 0 : 1, path: "/accounting/periods", tone: "amber" });
  }
  if ([ROLES.ADMIN, ROLES.BUDGET].includes(user.role)) {
    items.push({ key: "budgetExceptions", label: "Budget exceptions pending", count: await BudgetException.countDocuments({ status: "PENDING" }), path: "/budget", tone: "red" });
  }
  return { items, total: items.reduce((sum, item) => sum + Number(item.count || 0), 0), counters: Object.fromEntries(items.map((item) => [item.key, item.count])) };
}

async function commonSummary(user) {
  const scope = ownerScope(user);
  const [total, byStatus, byType, byCurrency, recentRequests] = await Promise.all([
    FinancialRequest.countDocuments(scope),
    FinancialRequest.aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FinancialRequest.aggregate([{ $match: scope }, { $group: { _id: "$requestType", count: { $sum: 1 }, amount: { $sum: "$totalPENEquivalent" } } }, { $sort: { amount: -1 } }]),
    FinancialRequest.aggregate([{ $match: scope }, { $group: { _id: "$currency", totalAmount: { $sum: "$totalAmount" }, penEquivalent: { $sum: "$totalPENEquivalent" } } }]),
    FinancialRequest.find(scope).populate("supplier", "name legalName rucDni").populate("requester", "name area").sort({ updatedAt: -1 }).limit(8)
  ]);
  return { total, byStatus, byType, byCurrency, recentRequests };
}

function statusCount(common, status) {
  return common.byStatus.find((item) => item._id === status)?.count || 0;
}

async function roleDetails(user, common) {
  const metrics = [];
  const warnings = [];
  const data = {};
  const period = currentPeriod();

  if (user.role === ROLES.ADMIN) {
    const [activeUsers, pendingSuppliers, blockedActions, recentActivity] = await Promise.all([
      User.countDocuments({ active: true }),
      Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION" }),
      AuditLog.countDocuments({ blocked: true, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
      AuditLog.find().populate("user", "name role").sort({ createdAt: -1 }).limit(8)
    ]);
    metrics.push(
      { key: "requests", label: "Total requests", value: common.total, tone: "navy" },
      { key: "users", label: "Active users", value: activeUsers, tone: "green" },
      { key: "workflow", label: "In active workflow", value: common.total - statusCount(common, REQUEST_STATUS.CLOSED) - statusCount(common, REQUEST_STATUS.VOIDED), tone: "teal" },
      { key: "supplierWarnings", label: "Supplier validations", value: pendingSuppliers, tone: "amber" },
      { key: "blocked", label: "Blocked controls (30d)", value: blockedActions, tone: blockedActions ? "red" : "neutral" }
    );
    data.recentActivity = recentActivity;
  }

  if (user.role === ROLES.SOLICITOR) {
    metrics.push(
      { key: "drafts", label: "My drafts", value: statusCount(common, REQUEST_STATUS.DRAFT), tone: "neutral" },
      { key: "returned", label: "Returned / observed", value: statusCount(common, REQUEST_STATUS.RETURNED) + statusCount(common, REQUEST_STATUS.OBSERVED) + statusCount(common, REQUEST_STATUS.REJECTED), tone: "red" },
      { key: "pending", label: "Pending approvals", value: statusCount(common, REQUEST_STATUS.PENDING_APPROVAL) + statusCount(common, REQUEST_STATUS.DIRECTOR_APPROVED) + statusCount(common, REQUEST_STATUS.VICE_RECTOR_APPROVED), tone: "amber" },
      { key: "rendition", label: "Rendition tasks", value: statusCount(common, REQUEST_STATUS.RENDITION_PENDING), tone: "teal" },
      { key: "closed", label: "Closed requests", value: statusCount(common, REQUEST_STATUS.CLOSED), tone: "green" }
    );
  }

  if (user.role === ROLES.APPROVER) {
    const query = approvalScope(user);
    const [waiting, oldest, decisions] = await Promise.all([
      FinancialRequest.aggregate([{ $match: query }, { $group: { _id: null, amount: { $sum: "$totalPENEquivalent" }, count: { $sum: 1 } } }]),
      FinancialRequest.find(query).populate("supplier", "name legalName").sort({ approvalDueAt: 1 }).limit(6),
      FinancialRequest.find({ "approvalHistory.actor": user._id }).populate("supplier", "name legalName").sort({ updatedAt: -1 }).limit(6)
    ]);
    const summary = waiting[0] || { amount: 0, count: 0 };
    metrics.push(
      { key: "pending", label: "Pending approvals", value: summary.count, tone: "amber" },
      { key: "amount", label: "PEN waiting", value: summary.amount, tone: "teal", format: "currency" },
      { key: "oldest", label: "Oldest approval", value: oldest[0] ? Math.max(0, Math.floor((Date.now() - oldest[0].createdAt.getTime()) / 86400000)) : 0, suffix: "days", tone: "navy" },
      { key: "overdue", label: "SLA overdue", value: await FinancialRequest.countDocuments({ ...query, approvalDueAt: { $lt: new Date() } }), tone: "red" }
    );
    data.oldestRequests = oldest;
    data.recentDecisions = decisions;
  }

  if (user.role === ROLES.MANAGEMENT) {
    const [overview, pendingCommitments] = await Promise.all([
      budgetOverview({ period }),
      FinancialRequest.countDocuments({ status: { $in: [REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.BUDGET_COMMITTED] } })
    ]);
    const typeTotals = new Map(common.byType.map((item) => [item._id, item.amount || 0]));
    const totalSpend = common.byType.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    metrics.push(
      { key: "spend", label: "Controlled spend", value: totalSpend, format: "currency", tone: "navy" },
      { key: "capex", label: "CAPEX", value: typeTotals.get("CAPEX") || 0, format: "currency", tone: "teal" },
      { key: "opex", label: "OPEX", value: typeTotals.get("OPEX") || 0, format: "currency", tone: "neutral" },
      { key: "available", label: "Budget available", value: overview.totals.available, format: "currency", tone: "green" },
      { key: "commitments", label: "Pending commitments", value: pendingCommitments, tone: "amber" }
    );
    data.budget = overview;
  }

  if (user.role === ROLES.ACCOUNTING) {
    const [periodRecord, journals, cxp, pendingClosure, missingDates] = await Promise.all([
      AccountingPeriod.findOne({ period }),
      JournalEntry.aggregate([{ $match: { period, status: "POSTED" } }, { $group: { _id: null, count: { $sum: 1 }, debit: { $sum: "$totalDebit" }, credit: { $sum: "$totalCredit" } } }]),
      AccountsPayable.countDocuments({ status: { $ne: AP_STATUS.CANCELLED } }),
      FinancialRequest.countDocuments({ accountingPeriod: period, status: { $nin: [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED] } }),
      missingExchangeRateDates()
    ]);
    const journal = journals[0] || { count: 0, debit: 0, credit: 0 };
    metrics.push(
      { key: "period", label: "Current period", value: periodRecord?.status || "NOT_CREATED", format: "text", tone: periodRecord?.status === "OPEN" ? "green" : "amber" },
      { key: "cxp", label: "Accounts payable", value: cxp, tone: "navy" },
      { key: "debit", label: "Debit total", value: journal.debit, format: "currency", tone: "teal" },
      { key: "credit", label: "Credit total", value: journal.credit, format: "currency", tone: "neutral" },
      { key: "closure", label: "Pending period items", value: pendingClosure, tone: "amber" }
    );
    if (missingDates.length) warnings.push({ key: "missingRates", label: "Missing exchange-rate dates", count: missingDates.length, details: missingDates, path: "/exchange-rates", tone: "red" });
  }

  if (user.role === ROLES.TREASURY) {
    const queue = await AccountsPayable.find({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED] } }).populate("supplier").populate("request").sort({ dueDate: 1 });
    const totals = queue.reduce((result, item) => ({ ...result, [item.currency]: (result[item.currency] || 0) + item.outstandingAmount }), {});
    const supplierIds = queue.map((item) => item.supplier?._id).filter(Boolean);
    const validBankSuppliers = new Set((await SupplierBankAccount.find({ supplier: { $in: supplierIds }, active: true }).select("supplier")).map((item) => String(item.supplier)));
    const missingBank = queue.filter((item) => !validBankSuppliers.has(String(item.supplier?._id))).length;
    const recentFiles = await PaymentBatch.find().populate("generatedBy", "name role").sort({ generatedAt: -1 }).limit(6);
    metrics.push(
      { key: "queue", label: "Payable queue", value: queue.length, tone: "amber" },
      { key: "pen", label: "PEN waiting", value: totals.PEN || 0, format: "currency", currency: "PEN", tone: "teal" },
      { key: "usd", label: "USD waiting", value: totals.USD || 0, format: "currency", currency: "USD", tone: "navy" },
      { key: "missingBank", label: "Missing bank details", value: missingBank, tone: missingBank ? "red" : "green" },
      { key: "files", label: "Recent bank files", value: recentFiles.length, tone: "neutral" }
    );
    data.queue = queue.slice(0, 8);
    data.recentFiles = recentFiles;
  }

  if (user.role === ROLES.BUDGET) {
    const overview = await budgetOverview({ period });
    metrics.push(
      { key: "assigned", label: "Assigned", value: overview.totals.assigned, format: "currency", tone: "navy" },
      { key: "available", label: "Available", value: overview.totals.available, format: "currency", tone: "green" },
      { key: "committed", label: "Committed", value: overview.totals.committed, format: "currency", tone: "amber" },
      { key: "executed", label: "Executed", value: overview.totals.executed, format: "currency", tone: "teal" },
      { key: "paid", label: "Paid", value: overview.totals.paid, format: "currency", tone: "neutral" }
    );
    data.budget = overview;
  }
  return { metrics, warnings, ...data };
}

export const getTaskSummary = asyncHandler(async (req, res) => res.json(await buildTasks(req.user)));

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const [common, tasks] = await Promise.all([commonSummary(req.user), buildTasks(req.user)]);
  const details = await roleDetails(req.user, common);
  res.json({ role: req.user.role, ...common, tasks, ...details, lastUpdated: new Date().toISOString() });
});
