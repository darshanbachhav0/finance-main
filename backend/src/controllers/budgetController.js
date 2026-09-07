import BudgetException from "../models/BudgetException.js";
import BudgetCommitment from "../models/BudgetCommitment.js";
import CostCenter from "../models/CostCenter.js";
import ExpenseType from "../models/ExpenseType.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { commitApprovedRequestBudget } from "../services/approvalService.js";
import { budgetOverview } from "../services/budgetOverviewService.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { publicRequestPayload } from "../services/requestService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { budgetAllocationRows, budgetPeriodFilter } from "../services/budgetReportingService.js";
import { adjustBudgetPlan, createBudgetPlan, getBudgetPlan } from "../services/budgetPlanService.js";

export const getBudgetOverview = asyncHandler(async (req, res) => {
  res.json({ data: await budgetOverview(req.query) });
});

export const listBudgetAllocations = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const rows = await budgetAllocationRows(req.query);
  const fields = ["period", "assignedAmount", "committedAmount", "executedAmount", "paidAmount"];
  const sort = fields.includes(req.query.sortBy) ? req.query.sortBy : "period";
  const direction = req.query.sortDirection === "asc" ? 1 : -1;
  rows.sort((a, b) => (typeof a[sort] === "number" ? a[sort] - b[sort] : String(a[sort] || "").localeCompare(String(b[sort] || ""))) * direction);
  res.json(paginatedPayload(rows.slice(skip, skip + pageSize), rows.length, page, pageSize));
});

export const readBudgetPlan = asyncHandler(async (req, res) => res.json({ data: await getBudgetPlan(req.params.id) }));
export const addBudgetPlan = asyncHandler(async (req, res) => res.status(201).json({ data: await createBudgetPlan(req.body, req.user, req) }));
export const changeBudgetPlan = asyncHandler(async (req, res) => res.json({ data: await adjustBudgetPlan(req.params.id, req.body, req.user, req) }));

export const listBudgetCommitments = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const query = {};
  if (req.query.period) query.period = budgetPeriodFilter(req.query.period);
  if (req.query.status) query.status = req.query.status;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ requestNumber: search }, { period: search }];
  }
  const sort = parseSort(req.query, ["requestNumber", "period", "status", "totalAmount", "createdAt"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    BudgetCommitment.find(query)
      .populate("request", "requestNumber requestType status priority requesterArea requestingArea project")
      .populate("lines.costCenter", "code name area budgetMode")
      .populate("lines.expenseType", "code name accountNumber category")
      .populate("lines.budgetException")
      .populate("createdBy", "name role")
      .sort(sort).skip(skip).limit(pageSize),
    BudgetCommitment.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

export const listBudgetExceptions = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const clauses = [];
  if (req.query.status) clauses.push({ status: req.query.status });
  if (req.query.strategy) clauses.push({ strategy: req.query.strategy });
  if (req.query.period) {
    const requestIds = await FinancialRequest.find({ accountingPeriod: budgetPeriodFilter(req.query.period) }).distinct("_id");
    clauses.push({ request: { $in: requestIds } });
  }
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const [requestIds, costCenterIds, expenseTypeIds] = await Promise.all([
      FinancialRequest.find({ requestNumber: search }).distinct("_id"),
      CostCenter.find({ $or: [{ code: search }, { name: search }] }).distinct("_id"),
      ExpenseType.find({ $or: [{ code: search }, { name: search }, { accountNumber: search }] }).distinct("_id")
    ]);
    clauses.push({ $or: [
      { dimensionKey: search },
      { strategy: search },
      { request: { $in: requestIds } },
      { costCenter: { $in: costCenterIds } },
      { expenseType: { $in: expenseTypeIds } }
    ] });
  }
  const query = clauses.length ? { $and: clauses } : {};
  const sort = parseSort(req.query, ["status", "strategy", "availableAmount", "requestedAmount", "createdAt"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    BudgetException.find(query)
      .populate("request", "requestNumber requestType status totalPENEquivalent accountingPeriod")
      .populate("costCenter", "code name area")
      .populate("expenseType", "code name accountNumber")
      .populate("requestedBy reviewedBy", "name role")
      .sort(sort).skip(skip).limit(pageSize),
    BudgetException.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

export const decideBudgetException = asyncHandler(async (req, res) => {
  const status = String(req.body.status || "").toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(status)) throw new AppError(422, "Budget exception decision must be APPROVED or REJECTED.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (!String(req.body.comments || "").trim()) throw new AppError(422, "Decision comments are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const exception = await BudgetException.findById(req.params.id);
  if (!exception) throw new AppError(404, "Budget exception not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (exception.status !== "PENDING") throw new AppError(409, "Budget exception has already been decided.", { status: exception.status }, ERROR_CODES.CONFLICT);
  exception.status = status;
  exception.reviewedBy = req.user._id;
  exception.reviewedAt = new Date();
  exception.comments = req.body.comments;
  await exception.save();
  await recordAudit({ entityType: "BudgetException", entity: exception, requestId: exception.request, action: status, user: req.user, req, module: "BUDGET", comments: req.body.comments, newValues: { status, strategy: exception.strategy } });
  res.json({ data: exception });
});

export const commitRequestBudget = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  await commitApprovedRequestBudget({ request, user: req.user, req });
  res.json({ data: publicRequestPayload(request) });
});
