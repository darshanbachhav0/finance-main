import BudgetException from "../models/BudgetException.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
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
import { subtractMoney } from "../utils/money.js";

export const getBudgetOverview = asyncHandler(async (req, res) => {
  res.json({ data: await budgetOverview(req.query) });
});

export const listBudgetAllocations = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const baseQuery = { active: true };
  if (req.query.period) baseQuery.period = req.query.period;
  if (req.query.costCenter) baseQuery.costCenter = req.query.costCenter;
  if (req.query.expenseType) baseQuery.expenseType = req.query.expenseType;
  if (req.query.project !== undefined && req.query.project !== "") baseQuery.project = req.query.project;

  const hasDimensionalAllocations = await BudgetAllocation.exists(baseQuery);
  const requestedSource = String(req.query.source || "");
  const useTransitional = !hasDimensionalAllocations && requestedSource !== "DIMENSIONAL_ALLOCATION";
  if (useTransitional) {
    const centerQuery = { active: true };
    if (req.query.costCenter) centerQuery._id = req.query.costCenter;
    if (req.query.area) centerQuery.area = req.query.area;
    if (req.query.search) {
      const search = new RegExp(escapedRegex(req.query.search), "i");
      centerQuery.$or = [{ code: search }, { name: search }, { area: search }];
    }
    const sortAliases = { assignedAmount: "annualBudget", committedAmount: "committedAmount", executedAmount: "executedAmount", paidAmount: "paidAmount" };
    const requestedSort = sortAliases[req.query.sortBy] || req.query.sortBy;
    const sort = parseSort({ ...req.query, sortBy: requestedSort }, ["code", "name", "annualBudget", "committedAmount", "executedAmount", "paidAmount"], { code: 1 });
    const [centers, total] = await Promise.all([
      CostCenter.find(centerQuery).sort(sort).skip(skip).limit(pageSize),
      CostCenter.countDocuments(centerQuery)
    ]);
    const rows = centers.map((center) => ({
      _id: center._id,
      period: req.query.period || "",
      costCenter: center,
      assignedAmount: center.annualBudget,
      committedAmount: center.committedAmount,
      executedAmount: center.executedAmount,
      paidAmount: center.paidAmount,
      availableAmount: center.availableAmount,
      source: "TRANSITIONAL_COST_CENTER"
    }));
    return res.json(paginatedPayload(rows, total, page, pageSize));
  }

  if (requestedSource === "TRANSITIONAL_COST_CENTER") return res.json(paginatedPayload([], 0, page, pageSize));
  const query = { ...baseQuery };
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const [costCenters, expenseTypes] = await Promise.all([
      CostCenter.find({ $or: [{ code: search }, { name: search }, { area: search }] }).distinct("_id"),
      ExpenseType.find({ $or: [{ code: search }, { name: search }, { accountNumber: search }] }).distinct("_id")
    ]);
    query.$or = [
      { period: search },
      { project: search },
      { costCenter: { $in: costCenters } },
      { expenseType: { $in: expenseTypes } }
    ];
  }
  const sort = parseSort(req.query, ["period", "project", "assignedAmount", "committedAmount", "executedAmount", "paidAmount", "createdAt"], { period: -1, createdAt: -1 });
  const [allocations, total] = await Promise.all([
    BudgetAllocation.find(query).populate("costCenter").populate("expenseType").sort(sort).skip(skip).limit(pageSize),
    BudgetAllocation.countDocuments(query)
  ]);
  const rows = allocations.map((allocation) => ({
    ...allocation.toObject(),
    availableAmount: subtractMoney(subtractMoney(allocation.assignedAmount, allocation.committedAmount), allocation.executedAmount),
    source: "DIMENSIONAL_ALLOCATION"
  }));
  res.json(paginatedPayload(rows, total, page, pageSize));
});

export const listBudgetCommitments = asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const query = {};
  if (req.query.period) query.period = req.query.period;
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
    const requestIds = await FinancialRequest.find({ accountingPeriod: req.query.period }).distinct("_id");
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
