import AccountsPayable from "../models/AccountsPayable.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import AuditLog from "../models/AuditLog.js";
import BudgetException from "../models/BudgetException.js";
import ExchangeRate from "../models/ExchangeRate.js";
import FinancialRequest from "../models/FinancialRequest.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentBatch from "../models/PaymentBatch.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import EmployeeReimbursementBankAccount from "../models/EmployeeReimbursementBankAccount.js";
import User from "../models/User.js";
import { slaStatus } from "../services/approvalRuleService.js";
import { slaConfiguration } from "../services/slaPolicy.js";
import { countEscalatedApprovals } from "../services/slaMonitoringService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { budgetOverview } from "../services/budgetReportingService.js";
import { isEligibleSupplierPaymentAccount, usesEmployeeReimbursementDestination } from "../services/paymentDestinationService.js";
import { budgetExceptionPath, countPendingBudgetExceptions } from "../services/budgetExceptionService.js";
import { APPROVAL_STAGES, AP_STATUS, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { requestVisibilityFilter } from "../utils/permissions.js";
import { REPORTING_EXCLUDED_REQUEST_STATUSES } from "../../../shared/openPayables.mjs";

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function ownerScope(user) {
  return user.role === ROLES.SOLICITOR ? { $or: [{ requester: user._id }, { solicitor: user._id }] } : {};
}

// Requests the dashboard may count or list for this user: what the request list would show them
// (requestVisibilityFilter; a Solicitor's dashboard stays on their own requests), and never
// somebody else's draft.
export function dashboardRequestScope(user) {
  const visibility = user.role === ROLES.SOLICITOR ? ownerScope(user) : requestVisibilityFilter(user);
  const notOthersDrafts = { $or: [{ status: { $ne: REQUEST_STATUS.DRAFT } }, { requester: user._id }, { solicitor: user._id }] };
  return { $and: [visibility, notOthersDrafts].filter((clause) => Object.keys(clause).length) };
}

// Treasury can pay a payable only to a verified destination: a destination frozen on the CXP
// when it was scheduled, the verified employee reimbursement snapshot, or an eligible verified
// supplier CURRENT account in the payable's currency (see paymentDestinationService.js).
function hasVerifiedPaymentDestination(payable, supplierAccounts) {
  const frozen = payable.bankAccountSnapshot;
  if (payable.status !== AP_STATUS.OPEN && frozen?.bank && (frozen.accountNumber || frozen.cci)) return true;
  const request = payable.request;
  if (request && usesEmployeeReimbursementDestination(request)) return request.rendition?.reimbursementBankSnapshot?.verificationStatus === "VERIFIED";
  const supplierId = String(payable.supplier?._id || payable.supplier || request?.supplier?._id || request?.supplier || "");
  return (supplierAccounts.get(supplierId) || []).some((account) => isEligibleSupplierPaymentAccount(account, { currency: payable.currency }));
}

function approvalScope(user) {
  const query = { status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] }, approvalStage: { $ne: "COMPLETE" } };
  if (user.role !== ROLES.ADMIN) {
    const chain = { approvalRouteSnapshot: { $elemMatch: { approverUser: user._id, status: "PENDING", source: "MANAGER_CHAIN" } } };
    if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.MANAGEMENT].includes(user.role)) {
      const legacy = { approvalStage: user.approvalLevel || APPROVAL_STAGES.AREA_DIRECTOR };
      if (legacy.approvalStage === APPROVAL_STAGES.AREA_DIRECTOR) {
        const areas = [user.area, ...(user.approvalAreas || [])].filter(Boolean);
        if (!areas.includes("*")) legacy.$or = [{ requesterArea: { $in: areas } }, { requestingArea: { $in: areas } }];
      }
      query.$or = [chain, legacy];
    } else Object.assign(query, chain);
  }
  return query;
}

// Request list filtered to Track A1 requests with committed budget and no Purchase Order yet.
export const AWAITING_PURCHASE_ORDER_PATH = "/requests?status=PENDIENTE_OC";

async function missingExchangeRateDates() {
  const requests = await FinancialRequest.find({ currency: "USD", status: { $nin: [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED] } }).select("issueDate").lean();
  const dates = [...new Set(requests.map((request) => new Date(request.issueDate).toISOString().slice(0, 10)))];
  if (!dates.length) return [];
  const configured = await ExchangeRate.find({ active: true, date: { $in: dates.map((value) => new Date(`${value}T00:00:00.000Z`)) } }).select("date").lean();
  const available = new Set(configured.map((item) => item.date.toISOString().slice(0, 10)));
  return dates.filter((date) => !available.has(date)).sort();
}

// Management decides budget exceptions in the Approval Inbox, next to its approvals.
export const BUDGET_EXCEPTION_DECISIONS_PATH = "/approvals#budget-exceptions";

// Requester statuses that wait on the requester's own correction (see canModifyRequest).
const OWNER_CORRECTION_STATUSES = [REQUEST_STATUS.RETURNED, REQUEST_STATUS.OBSERVED, REQUEST_STATUS.OBSERVED_BUDGET, REQUEST_STATUS.OBSERVED_SUNAT, REQUEST_STATUS.OBSERVED_AMOUNT_EXCEEDED, REQUEST_STATUS.OBSERVED_BATCH];
const TERMINAL_REQUEST_STATUSES = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED];

// A task that counts exactly one record opens that record rather than the filtered list.
async function singleRecordPath(count, Model, query, toPath) {
  if (count !== 1) return undefined;
  const record = await Model.findOne(query).select("_id supplier").lean();
  return record ? toPath(record) : undefined;
}

// Earliest due date among the task's records (drives "due Thursday" and the urgency tone).
async function earliestDate(Model, query, field) {
  const record = await Model.findOne({ $and: [query, { [field]: { $ne: null } }] }).sort({ [field]: 1 }).select(field).lean();
  return field.split(".").reduce((value, key) => value?.[key], record) || null;
}

// Budget exceptions still open: PENDING and not attached to a terminal request (the rule
// countPendingBudgetExceptions applies). awaitingDecision keeps only the ones Budget reviewed.
async function openBudgetExceptions({ awaitingDecision = false } = {}) {
  const query = { status: "PENDING", ...(awaitingDecision ? { preparedAt: { $ne: null } } : {}) };
  const exceptions = await BudgetException.find(query)
    .populate({ path: "request", select: "requestNumber requestType status totalAmount currency totalPENEquivalent requester solicitor requesterArea requestingArea", populate: { path: "requester", select: "name area" } })
    .populate("costCenter", "code name area")
    .populate("expenseType", "code name accountNumber")
    .populate("requestedBy preparedBy", "name role")
    .sort({ preparedAt: 1, createdAt: 1 });
  return exceptions.filter((exception) => exception.request && !TERMINAL_REQUEST_STATUSES.includes(exception.request.status));
}

// Each task carries its count, an urgency tone and where it opens: the exact record when there
// is only one, otherwise the pre-filtered list. Optional fields feed the dashboard's "My tasks":
// dueAt (earliest due date), overdue (how many are past due), kind (the variant of the task this
// role sees) and partOf (a detail shown inside another task rather than as its own row).
async function buildTasks(user) {
  const items = [];
  const now = new Date();
  if (user.role !== ROLES.MANAGEMENT_VIEWER) {
    const query = approvalScope(user);
    const [count, overdue, dueAt] = await Promise.all([
      FinancialRequest.countDocuments(query),
      FinancialRequest.countDocuments({ ...query, approvalDueAt: { $lt: now } }),
      earliestDate(FinancialRequest, query, "approvalDueAt")
    ]);
    const single = await singleRecordPath(count, FinancialRequest, query, (record) => `/approvals?request=${record._id}`);
    items.push({ key: "approval", label: "Requests awaiting approval", count, path: single || "/approvals", tone: overdue ? "red" : "amber", dueAt, overdue });
    items.push({ key: "approvalOverdue", label: "Approval SLA overdue", count: overdue, path: "/approvals", tone: "red", partOf: "approval" });
    const config = slaConfiguration();
    items.push({ key: "approvalDueSoon", label: "Approval due soon", count: await FinancialRequest.countDocuments({ ...query, approvalDueAt: { $gte: now, $lte: new Date(now.getTime() + config.dueSoonHours * 3600000) } }), path: "/approvals", tone: "amber", partOf: "approval" });
    const escalationScope = user.role === ROLES.MANAGEMENT ? approvalScope({ role: ROLES.ADMIN }) : query;
    items.push({ key: "approvalEscalated", label: "SLA escalation", count: await countEscalatedApprovals(escalationScope, { config }), path: user.role === ROLES.MANAGEMENT ? "/requests" : "/approvals", tone: "red", ...(user.role === ROLES.MANAGEMENT ? {} : { partOf: "approval" }) });
  }
  if (user.role === ROLES.SOLICITOR) {
    const owner = ownerScope(user);
    const draftQuery = { ...owner, status: REQUEST_STATUS.DRAFT };
    const correctionQuery = { ...owner, status: { $in: OWNER_CORRECTION_STATUSES } };
    const [drafts, corrections] = await Promise.all([FinancialRequest.countDocuments(draftQuery), FinancialRequest.countDocuments(correctionQuery)]);
    items.push({ key: "drafts", label: "Drafts to finish", count: drafts, path: (await singleRecordPath(drafts, FinancialRequest, draftQuery, (record) => `/requests/${record._id}/edit`)) || `/requests?status=${REQUEST_STATUS.DRAFT}`, tone: "neutral" });
    items.push({ key: "corrections", label: "Requests to correct", count: corrections, path: (await singleRecordPath(corrections, FinancialRequest, correctionQuery, (record) => `/requests/${record._id}`)) || `/requests?status=${OWNER_CORRECTION_STATUSES.join("%2C")}`, tone: "red" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SOLICITOR].includes(user.role)) {
    // Each role sees the rendition work that is its own: the requester submits (PENDING or
    // OBSERVED, against the deadline), Accounting reviews what was SUBMITTED, Admin oversees all.
    const kind = user.role === ROLES.SOLICITOR ? "submit" : user.role === ROLES.ACCOUNTING ? "review" : "outstanding";
    const statuses = { submit: ["PENDING", "OBSERVED"], review: ["SUBMITTED"], outstanding: ["PENDING", "SUBMITTED", "OBSERVED"] }[kind];
    const query = { flowType: "C", "rendition.status": { $in: statuses }, status: { $nin: TERMINAL_REQUEST_STATUSES } };
    if (user.role === ROLES.SOLICITOR) query.$or = [{ requester: user._id }, { solicitor: user._id }];
    const count = await FinancialRequest.countDocuments(query);
    const deadline = kind === "submit" ? {
      dueAt: await earliestDate(FinancialRequest, query, "rendition.dueAt"),
      overdue: await FinancialRequest.countDocuments({ ...query, "rendition.dueAt": { $lt: now } })
    } : {};
    const label = { submit: "Renditions to submit", review: "Renditions to review", outstanding: "Renditions outstanding" }[kind];
    const single = await singleRecordPath(count, FinancialRequest, query, (record) => `/requests/${record._id}`);
    items.push({ key: "rendition", kind, label, count, path: single || `/requests?renditionStatus=${statuses.join("%2C")}`, tone: deadline.overdue ? "red" : "amber", ...deadline });
  }
  if ([ROLES.ADMIN, ROLES.TREASURY].includes(user.role)) {
    const payableQuery = { status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED] } };
    const confirmationQuery = { status: { $in: [AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID] } };
    const bouncedQuery = { status: AP_STATUS.PAYMENT_BOUNCED };
    const [payable, confirmation, bounced, payableDueAt, payableOverdue] = await Promise.all([
      AccountsPayable.countDocuments(payableQuery),
      AccountsPayable.countDocuments(confirmationQuery),
      AccountsPayable.countDocuments(bouncedQuery),
      earliestDate(AccountsPayable, payableQuery, "dueDate"),
      AccountsPayable.countDocuments({ ...payableQuery, dueDate: { $lt: now } })
    ]);
    items.push({ key: "payable", label: "CXP ready for Treasury", count: payable, path: (await singleRecordPath(payable, AccountsPayable, payableQuery, (record) => `/treasury?tab=prepare&record=${record._id}`)) || "/treasury?tab=prepare", tone: payableOverdue ? "red" : "teal", dueAt: payableDueAt, overdue: payableOverdue });
    items.push({ key: "paymentConfirmation", label: "Payments awaiting confirmation", count: confirmation, path: (await singleRecordPath(confirmation, AccountsPayable, confirmationQuery, (record) => `/treasury?tab=confirm&record=${record._id}`)) || "/treasury?tab=confirm", tone: "amber" });
    items.push({ key: "bouncedPayments", label: "Returned payments to reprogram", count: bounced, path: (await singleRecordPath(bounced, AccountsPayable, bouncedQuery, (record) => `/treasury?tab=returned&record=${record._id}`)) || "/treasury?tab=returned", tone: "red" });
  }
  if ([ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) {
    const bankReviewQuery = { active: true, verificationStatus: "PENDING" };
    const [employeeBankReviews, supplierBankReviews, suppliers] = await Promise.all([
      EmployeeReimbursementBankAccount.countDocuments(bankReviewQuery),
      SupplierBankAccount.countDocuments(bankReviewQuery),
      Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION" })
    ]);
    items.push({ key: "employeeBankReviews", label: "Reimbursement bank profiles awaiting review", count: employeeBankReviews, path: (await singleRecordPath(employeeBankReviews, EmployeeReimbursementBankAccount, bankReviewQuery, (record) => `/reimbursement-bank?record=${record._id}`)) || "/reimbursement-bank?verificationStatus=PENDING", tone: "amber" });
    items.push({ key: "supplierBankReviews", label: "Supplier bank accounts awaiting review", count: supplierBankReviews, path: (await singleRecordPath(supplierBankReviews, SupplierBankAccount, bankReviewQuery, (record) => `/suppliers?record=${record.supplier}`)) || "/suppliers", tone: "amber" });
    items.push({ key: "accounting", label: "Requests awaiting fiscal processing", count: await FinancialRequest.countDocuments({ status: REQUEST_STATUS.BUDGET_COMMITTED }), path: "/accounting", tone: "teal" });
    items.push({ key: "suppliers", label: "Suppliers awaiting homologation", count: suppliers, path: (await singleRecordPath(suppliers, Supplier, { homologationStatus: "PENDING_VALIDATION" }, (record) => `/suppliers?record=${record._id}`)) || "/suppliers", tone: "amber" });
    const missingDates = await missingExchangeRateDates();
    items.push({ key: "missingExchangeRate", label: "Missing exchange-rate dates", count: missingDates.length, details: missingDates, path: "/exchange-rates", tone: "red" });
    const period = await AccountingPeriod.findOne({ period: currentPeriod() });
    items.push({ key: "period", label: period?.status === "OPEN" ? "Current accounting period open" : "Current accounting period unavailable", count: period?.status === "OPEN" ? 0 : 1, path: "/accounting/periods", tone: "amber" });
  }
  // Budget/Admin see every open exception (review first); Management sees the ones Budget has
  // reviewed and that now await its decision, decided from the Approval Inbox. Moot or
  // terminal-request exceptions never count.
  if ([ROLES.ADMIN, ROLES.BUDGET, ROLES.MANAGEMENT].includes(user.role)) {
    const management = user.role === ROLES.MANAGEMENT;
    const count = await countPendingBudgetExceptions(management ? { awaitingDecision: true } : {});
    const single = !management && count === 1 ? (await openBudgetExceptions())[0] : null;
    items.push({ key: "budgetExceptions", kind: management ? "decide" : "review", label: management ? "Budget exceptions awaiting your decision" : "Budget exceptions pending", count, path: management ? BUDGET_EXCEPTION_DECISIONS_PATH : single ? budgetExceptionPath(single) : "/budget?tab=exceptions&exceptionStatus=PENDING", tone: "red" });
  }
  if ([ROLES.ADMIN, ROLES.PROCUREMENT].includes(user.role)) {
    const orderQuery = { flowType: "A1", status: REQUEST_STATUS.BUDGET_COMMITTED, purchaseOrder: null };
    const awaitingOrder = await FinancialRequest.countDocuments(orderQuery);
    items.push({ key: "procurementOrders", label: "Approved requests awaiting a Purchase Order", count: awaitingOrder, path: (await singleRecordPath(awaitingOrder, FinancialRequest, orderQuery, (record) => `/requests/${record._id}`)) || AWAITING_PURCHASE_ORDER_PATH, tone: "amber" });
  }
  // partOf details are subsets of another task, so they never add to the total.
  return { items, total: items.filter((item) => !item.partOf).reduce((sum, item) => sum + Number(item.count || 0), 0), counters: Object.fromEntries(items.map((item) => [item.key, item.count])) };
}

// Management's budget-exception decisions for the Approval Inbox: the exceptions Budget has
// reviewed that are still open. Admin sees them read-only - only Management may decide one
// (assertExceptionDecisionAllowed), and never an exception it requested or prepared itself.
export async function listBudgetExceptionDecisionQueue(user) {
  const exceptions = await openBudgetExceptions({ awaitingDecision: true });
  const own = (value) => value && String(value?._id || value) === String(user._id);
  const data = exceptions.map((exception) => {
    const row = exception.toObject();
    const conflict = [row.requestedBy, row.preparedBy, row.request?.requester, row.request?.solicitor, ...(row.history || []).filter((event) => ["CREATED", "REVIEWED"].includes(event.action)).map((event) => event.by)].some(own);
    return { ...row, path: budgetExceptionPath(exception), canDecide: user.role === ROLES.MANAGEMENT && !conflict, blockedReason: user.role !== ROLES.MANAGEMENT ? "Only Management may decide a budget exception." : conflict ? "You cannot decide your own request or an exception you prepared." : undefined };
  });
  return { data, total: data.length, canDecide: user.role === ROLES.MANAGEMENT };
}

async function commonSummary(user) {
  const scope = dashboardRequestScope(user);
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
      { key: "workflow", label: "In active workflow", value: common.total - statusCount(common, REQUEST_STATUS.CLOSED) - statusCount(common, REQUEST_STATUS.VOIDED) - statusCount(common, REQUEST_STATUS.REJECTED), tone: "teal" },
      { key: "supplierWarnings", label: "Supplier validations", value: pendingSuppliers, tone: "amber" },
      { key: "blocked", label: "Blocked controls (30d)", value: blockedActions, tone: blockedActions ? "red" : "neutral" }
    );
    data.recentActivity = recentActivity;
  }

  if (user.role === ROLES.SOLICITOR) {
    metrics.push(
      { key: "drafts", label: "My drafts", value: statusCount(common, REQUEST_STATUS.DRAFT), tone: "neutral" },
      { key: "returned", label: "Returned / observed", value: statusCount(common, REQUEST_STATUS.RETURNED) + statusCount(common, REQUEST_STATUS.OBSERVED), tone: "red" },
      { key: "pending", label: "Pending approvals", value: statusCount(common, REQUEST_STATUS.PENDING_APPROVAL) + statusCount(common, REQUEST_STATUS.DIRECTOR_APPROVED) + statusCount(common, REQUEST_STATUS.VICE_RECTOR_APPROVED), tone: "amber" },
      { key: "rendition", label: "Rendition tasks", value: await FinancialRequest.countDocuments({ ...ownerScope(user), flowType: "C", "rendition.status": { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }, status: { $nin: [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED] } }), tone: "teal" },
      { key: "closed", label: "Closed requests", value: statusCount(common, REQUEST_STATUS.CLOSED), tone: "green" }
    );
  }

  if ([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR].includes(user.role)) {
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
    data.oldestRequests = oldest.map(request => ({ ...request.toObject(), sla: slaStatus(request) }));
    data.recentDecisions = decisions;
  }

  if (user.role === ROLES.MANAGEMENT) {
    // Controlled spend follows the Reports rule: drafts, rejected and voided requests never count.
    const [overview, pendingCommitments, spendByType] = await Promise.all([
      budgetOverview({ period }),
      FinancialRequest.countDocuments({ status: { $in: [REQUEST_STATUS.APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED, REQUEST_STATUS.BUDGET_COMMITTED] } }),
      FinancialRequest.aggregate([{ $match: { $and: [dashboardRequestScope(user), { status: { $nin: [...REPORTING_EXCLUDED_REQUEST_STATUSES] } }] } }, { $group: { _id: "$requestType", amount: { $sum: "$totalPENEquivalent" } } }])
    ]);
    const typeTotals = new Map(spendByType.map((item) => [item._id, item.amount || 0]));
    const totalSpend = spendByType.reduce((sum, item) => sum + Number(item.amount || 0), 0);
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
    const queue = await AccountsPayable.find({ status: { $in: [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID] } }).populate("supplier").populate("request").sort({ dueDate: 1 });
    const totals = queue.reduce((result, item) => ({ ...result, [item.currency]: (result[item.currency] || 0) + item.outstandingAmount }), {});
    const supplierIds = [...new Set(queue.map((item) => String(item.supplier?._id || item.request?.supplier || "")).filter(Boolean))];
    const supplierAccounts = new Map();
    for (const account of await SupplierBankAccount.find({ supplier: { $in: supplierIds }, active: true, accountType: "CURRENT" })) {
      const key = String(account.supplier);
      supplierAccounts.set(key, [...(supplierAccounts.get(key) || []), account]);
    }
    const missingBank = queue.filter((item) => !hasVerifiedPaymentDestination(item, supplierAccounts)).length;
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

  if (user.role === ROLES.PROCUREMENT) {
    const [awaitingOrder, openOrders, recentOrders, invoicedAgainstOrders] = await Promise.all([
      FinancialRequest.countDocuments({ flowType: "A1", status: REQUEST_STATUS.BUDGET_COMMITTED, purchaseOrder: null }),
      PurchaseOrder.countDocuments({ status: { $in: ["ISSUED", "PARTIALLY_LIQUIDATED"] } }),
      PurchaseOrder.find().populate("supplier", "name legalName").sort({ issueDate: -1 }).limit(6),
      AccountsPayable.countDocuments({ purchaseOrder: { $ne: null }, status: { $ne: AP_STATUS.CANCELLED } })
    ]);
    metrics.push(
      { key: "awaitingOrder", label: "Approved, awaiting PO", value: awaitingOrder, tone: "amber" },
      { key: "openOrders", label: "Open Purchase Orders", value: openOrders, tone: "navy" },
      { key: "invoicedAgainstOrders", label: "Invoices received against POs", value: invoicedAgainstOrders, tone: "teal" },
      { key: "supplierWarnings", label: "Supplier validations", value: await Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION" }), tone: "amber" }
    );
    data.recentOrders = recentOrders;
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

export const getBudgetExceptionDecisions = asyncHandler(async (req, res) => res.json(await listBudgetExceptionDecisionQueue(req.user)));

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const [common, tasks] = await Promise.all([commonSummary(req.user), buildTasks(req.user)]);
  const details = await roleDetails(req.user, common);
  res.json({ role: req.user.role, ...common, tasks, ...details, lastUpdated: new Date().toISOString() });
});
