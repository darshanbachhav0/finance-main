import AccountingMapping from "../models/AccountingMapping.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import ApprovalRule from "../models/ApprovalRule.js";
import BankFormatConfiguration from "../models/BankFormatConfiguration.js";
import BudgetAllocation from "../models/BudgetAllocation.js";
import BudgetRule from "../models/BudgetRule.js";
import CostCenter from "../models/CostCenter.js";
import DocumentRule from "../models/DocumentRule.js";
import ExchangeRate from "../models/ExchangeRate.js";
import ExpenseType from "../models/ExpenseType.js";
import FinanceConfiguration from "../models/FinanceConfiguration.js";
import Project from "../models/Project.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { fetchLatestUsdPenSellingRate } from "../services/exchangeRateProvider.js";
import { closeAccountingPeriod, createAccountingPeriod, reopenAccountingPeriod } from "../services/periodAdministrationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function resourceController({ Model, label, fields, searchFields = [], sortFields = ["createdAt"], defaultSort = { createdAt: -1 }, populate = [] }) {
  return {
    list: asyncHandler(async (req, res) => {
      const query = {};
      if (req.query.active !== undefined && Model.schema.path("active")) query.active = req.query.active === "true";
      if (req.query.search && searchFields.length) {
        const regex = new RegExp(escapedRegex(req.query.search), "i");
        query.$or = searchFields.map((field) => ({ [field]: regex }));
      }
      for (const field of ["period", "status", "category", "purpose", "requestType", "expenseNature", "bank", "currency", "mode", "costCenter", "expenseType", "project"]) {
        if (req.query[field] !== undefined && Model.schema.path(field)) query[field] = req.query[field];
      }
      const { page, pageSize, skip } = parsePagination({ ...req.query, pageSize: req.query.pageSize || 100 });
      const sort = parseSort(req.query, sortFields, defaultSort);
      let find = Model.find(query).sort(sort).skip(skip).limit(pageSize);
      for (const path of populate) find = find.populate(path);
      const [data, total] = await Promise.all([find, Model.countDocuments(query)]);
      res.json(paginatedPayload(data, total, page, pageSize));
    }),
    create: asyncHandler(async (req, res) => {
      const payload = pick(req.body, fields);
      if (Model === ExchangeRate) {
        const date = new Date(payload.date);
        if (Number.isNaN(date.getTime())) throw new AppError(422, "A valid exchange-rate date is required.", undefined, ERROR_CODES.VALIDATION_ERROR);
        payload.date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        payload.period = payload.period || payload.date.toISOString().slice(0, 7);
        payload.createdBy = req.user._id;
        payload.providerMode ||= "MANUAL";
        payload.authoritative = payload.providerMode === "SUNAT" && payload.authoritative === true;
      }
      if (Model === FinanceConfiguration) payload.createdBy = req.user._id;
      const data = await Model.create(payload);
      await recordAudit({ entityType: label, entity: data, action: "CREATED", user: req.user, req, module: "MASTER_DATA", newValues: data.toObject() });
      res.status(201).json({ data });
    }),
    update: asyncHandler(async (req, res) => {
      const data = await Model.findById(req.params.id);
      if (!data) throw new AppError(404, `${label} not found.`, { id: req.params.id }, ERROR_CODES.NOT_FOUND);
      const oldValues = data.toObject();
      const payload = pick(req.body, fields.filter((field) => field !== "createdBy"));
      if (Model === ExchangeRate && payload.date) {
        const date = new Date(payload.date);
        payload.date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        payload.period = payload.period || payload.date.toISOString().slice(0, 7);
      }
      if (Model === FinanceConfiguration) payload.updatedBy = req.user._id;
      Object.assign(data, payload);
      await data.save();
      await recordAudit({ entityType: label, entity: data, action: "UPDATED", user: req.user, req, module: "MASTER_DATA", oldValues, newValues: data.toObject() });
      res.json({ data });
    }),
    remove: asyncHandler(async (req, res) => {
      const data = await Model.findById(req.params.id);
      if (!data) throw new AppError(404, `${label} not found.`, { id: req.params.id }, ERROR_CODES.NOT_FOUND);
      if (!Model.schema.path("active")) {
        throw new AppError(409, `${label} cannot be deleted because financial master history is retained.`, undefined, ERROR_CODES.CONFLICT);
      }
      const oldValues = { active: data.active };
      data.active = false;
      await data.save();
      await recordAudit({ entityType: label, entity: data, action: "DEACTIVATED", user: req.user, req, module: "MASTER_DATA", oldValues, newValues: { active: false } });
      res.json({ data });
    })
  };
}

export const costCenters = resourceController({
  Model: CostCenter,
  label: "CostCenter",
  fields: ["code", "name", "area", "annualBudget", "committedAmount", "executedAmount", "paidAmount", "budgetMode", "active"],
  searchFields: ["code", "name", "area"],
  sortFields: ["code", "name", "area", "annualBudget", "active"],
  defaultSort: { code: 1 }
});

export const expenseTypes = resourceController({
  Model: ExpenseType,
  label: "ExpenseType",
  fields: ["code", "name", "category", "accountingClass", "accountNumber", "permittedRequestTypes", "permittedExpenseNatures", "deductible", "active"],
  searchFields: ["code", "name", "accountNumber"],
  sortFields: ["code", "name", "accountNumber", "category", "active"],
  defaultSort: { code: 1 }
});

export const exchangeRates = {
  ...resourceController({
    Model: ExchangeRate,
    label: "ExchangeRate",
    fields: ["currency", "quoteCurrency", "date", "period", "rate", "source", "sourceLabel", "providerMode", "authoritative", "active", "createdBy"],
    searchFields: ["source", "sourceLabel", "period"],
    sortFields: ["date", "period", "rate", "source", "active"],
    defaultSort: { date: -1 },
    populate: [{ path: "createdBy", select: "name email role" }]
  }),
  current: asyncHandler(async (_req, res) => {
    const data = await fetchLatestUsdPenSellingRate();
    res.json({
      data: {
        ...data,
        providerMode: "BCRP_FALLBACK",
        authoritative: false,
        notice: "Online BCRP/SBS reference. It is not labelled as the authoritative SUNAT rate and must be reviewed before saving."
      }
    });
  })
};

export const projects = resourceController({
  Model: Project,
  label: "Project",
  fields: ["code", "name", "description", "costCenter", "active"],
  searchFields: ["code", "name", "description"],
  sortFields: ["code", "name", "active"],
  defaultSort: { code: 1 },
  populate: ["costCenter"]
});

export const approvalRules = resourceController({
  Model: ApprovalRule,
  label: "ApprovalRule",
  fields: ["name", "approvalLevel", "role", "area", "amountFrom", "amountTo", "requestType", "required", "sequence", "slaHours", "active"],
  searchFields: ["name", "area", "approvalLevel"],
  sortFields: ["sequence", "name", "approvalLevel", "active"],
  defaultSort: { sequence: 1 }
});

export const budgetRules = resourceController({
  Model: BudgetRule,
  label: "BudgetRule",
  fields: ["name", "mode", "exceptionStrategy", "costCenter", "expenseType", "project", "active", "effectiveFrom", "effectiveTo"],
  searchFields: ["name", "project"],
  sortFields: ["name", "mode", "active", "createdAt"],
  populate: ["costCenter", "expenseType"]
});

export const budgetAllocations = resourceController({
  Model: BudgetAllocation,
  label: "BudgetAllocation",
  fields: ["period", "costCenter", "expenseType", "project", "assignedAmount", "active"],
  searchFields: ["period", "project"],
  sortFields: ["period", "assignedAmount", "active", "createdAt"],
  populate: ["costCenter", "expenseType"]
});

export const documentRules = resourceController({
  Model: DocumentRule,
  label: "DocumentRule",
  fields: ["code", "requestType", "expenseNature", "requirements", "quotationPolicy", "active"],
  searchFields: ["code", "requestType", "expenseNature"],
  sortFields: ["code", "requestType", "expenseNature", "active"],
  defaultSort: { code: 1 }
});

export const accountingMappings = resourceController({
  Model: AccountingMapping,
  label: "AccountingMapping",
  fields: ["code", "name", "purpose", "requestType", "expenseNature", "bank", "currency", "accountNumber", "subAccount", "active"],
  searchFields: ["code", "name", "accountNumber", "purpose"],
  sortFields: ["code", "purpose", "accountNumber", "active"],
  defaultSort: { code: 1 }
});

export const bankFormats = resourceController({
  Model: BankFormatConfiguration,
  label: "BankFormatConfiguration",
  fields: ["bank", "currency", "mode", "specificationVersion", "certified", "notes", "active"],
  searchFields: ["bank", "specificationVersion", "notes"],
  sortFields: ["bank", "currency", "mode", "active"],
  defaultSort: { bank: 1, currency: 1 }
});

export const financeConfigurations = resourceController({
  Model: FinanceConfiguration,
  label: "FinanceConfiguration",
  fields: ["key", "numericValue", "currency", "behavior", "effectiveFrom", "effectiveTo", "active", "description", "source"],
  searchFields: ["key", "description", "source"],
  sortFields: ["key", "effectiveFrom", "effectiveTo", "numericValue", "active"],
  defaultSort: { key: 1, effectiveFrom: -1 },
  populate: [
    { path: "createdBy", select: "name email role" },
    { path: "updatedBy", select: "name email role" }
  ]
});

export const accountingPeriods = {
  list: asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination({ ...req.query, pageSize: req.query.pageSize || 100 });
    const query = req.query.status ? { status: req.query.status } : {};
    if (req.query.search) {
      const search = new RegExp(escapedRegex(req.query.search), "i");
      query.$or = [{ period: search }, { comments: search }];
    }
    const sort = parseSort(req.query, ["period", "status", "openedAt", "closedAt"], { period: -1 });
    const [data, total] = await Promise.all([
      AccountingPeriod.find(query)
        .populate("openedBy closedBy reopenedBy history.by", "name email role")
        .sort(sort).skip(skip).limit(pageSize),
      AccountingPeriod.countDocuments(query)
    ]);
    res.json(paginatedPayload(data, total, page, pageSize));
  }),
  create: asyncHandler(async (req, res) => {
    const data = await createAccountingPeriod({ payload: req.body, user: req.user, req });
    res.status(201).json({ data });
  }),
  close: asyncHandler(async (req, res) => {
    const data = await closeAccountingPeriod({ id: req.params.id, comments: req.body.comments, force: req.body.force, overrideReason: req.body.overrideReason, user: req.user, req });
    res.json({ data });
  }),
  reopen: asyncHandler(async (req, res) => {
    const data = await reopenAccountingPeriod({ id: req.params.id, comments: req.body.comments, user: req.user, req });
    res.json({ data });
  }),
  update: asyncHandler(async (_req, _res) => {
    throw new AppError(405, "Use the explicit close or reopen accounting-period action.", undefined, ERROR_CODES.CONFLICT);
  }),
  remove: asyncHandler(async (_req, _res) => {
    throw new AppError(405, "Accounting periods are retained and cannot be deleted.", undefined, ERROR_CODES.CONFLICT);
  })
};
