import { fetchSunatSellingRate } from "../services/sunatExchangeRateProvider.js";
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
import { resolveExchangeRateSnapshot } from "../services/exchangeRateService.js";
import { closeAccountingPeriod, createAccountingPeriod, reopenAccountingPeriod } from "../services/periodAdministrationService.js";
import { certifyBankFormatConfiguration } from "../services/treasuryService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { assertLegacyAllocationChange } from "../services/budgetPlanService.js";

export async function verifyExchangeRatePayload(payload) {
  if (!Number.isFinite(Number(payload.rate)) || Number(payload.rate) <= 0) throw new AppError(422, "A positive selling rate is required.");
  const date = new Date(payload.date);
  if (Number.isNaN(date.getTime())) throw new AppError(422, "A valid exchange-rate date is required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  payload.date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  payload.period = payload.date.toISOString().slice(0, 7);
  payload.retrievedAt = new Date();
  if (payload.providerMode === "SUNAT") {
    const verified = await fetchSunatSellingRate(payload.date.toISOString().slice(0, 10));
    if (verified.date !== payload.date.toISOString().slice(0, 10) || Number(payload.rate) !== verified.rate) throw new AppError(422, "Rate/date disagree with authoritative SUNAT evidence.");
    payload.source = payload.sourceLabel = verified.source;
    payload.authoritative = true;
    payload.sourceUrl = verified.sourceUrl;
  } else {
    payload.providerMode = payload.providerMode === "BCRP_FALLBACK" ? "BCRP_FALLBACK" : "MANUAL";
    payload.authoritative = false;
    payload.sourceUrl = undefined;
  }
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function resourceController({ Model, label, fields, searchFields = [], sortFields = ["createdAt"], defaultSort = { createdAt: -1 }, populate = [] }) {
  return {
    list: asyncHandler(async (req, res) => {
      const query = {};
      if (Model === BudgetAllocation) query.planningMode = { $nin: ["ANNUAL_ONLY", "ANNUAL_MONTHLY"] };
      if (req.query.active !== undefined && Model.schema.path("active")) query.active = req.query.active === "true";
      if (req.query.search && searchFields.length) {
        const regex = new RegExp(escapedRegex(req.query.search), "i");
        query.$or = searchFields.map((field) => ({ [field]: regex }));
      }
      for (const field of ["period", "status", "category", "purpose", "requestType", "expenseNature", "flowType", "phase", "bank", "currency", "mode", "costCenter", "expenseType", "project"]) {
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
      if (Model === BudgetAllocation) await assertLegacyAllocationChange(payload);
      if (Model === ExchangeRate) { await verifyExchangeRatePayload(payload); payload.createdBy = req.user._id; }
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
      if (Model === BudgetAllocation) await assertLegacyAllocationChange(payload, data);
      if (Model === ExchangeRate && Object.keys(payload).some(key => key !== "active")) {
        Object.assign(payload, { date: payload.date || data.date, rate: payload.rate ?? data.rate, providerMode: payload.providerMode || data.providerMode });
        await verifyExchangeRatePayload(payload);
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
      if (Model === BudgetAllocation) await assertLegacyAllocationChange({ active: false }, data);
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
  fields: ["code", "name", "area", "organizationalUnit", "organizationalUnitCode", "annualBudget", "budgetMode", "active"],
  searchFields: ["code", "name", "area", "organizationalUnit", "organizationalUnitCode"],
  sortFields: ["code", "name", "area", "organizationalUnit", "organizationalUnitCode", "annualBudget", "active"],
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
    const data = await resolveExchangeRateSnapshot("USD", _req.query.date || new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }));
    res.json({ data: { ...data, date: data.date.toISOString().slice(0, 10), period: data.date.toISOString().slice(0, 7), baseCurrency: "USD", quoteCurrency: "PEN", notice: data.authoritative ? "SUNAT selling rate" : "Reference fallback; not authoritative SUNAT" } });
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
  fields: ["name", "approvalLevel", "role", "area", "amountFrom", "amountTo", "requestType", "flowType", "required", "sequence", "slaHours", "active"],
  searchFields: ["name", "area", "approvalLevel"],
  sortFields: ["sequence", "name", "approvalLevel", "active"],
  defaultSort: { sequence: 1 }
});

export const budgetRules = resourceController({
  Model: BudgetRule,
  label: "BudgetRule",
  fields: ["name", "mode", "exceptionStrategy", "costCenter", "expenseType", "project", "exceptionApproverRole", "exceptionEscalationAmount", "exceptionEscalationApproverRole", "active", "effectiveFrom", "effectiveTo"],
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
  fields: ["code", "flowType", "phase", "requestType", "expenseNature", "requirements", "quotationPolicy", "active"],
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

export const bankFormats = {
  ...resourceController({
    Model: BankFormatConfiguration,
    label: "BankFormatConfiguration",
    // "certified" is intentionally excluded here: it can only change through the dedicated
    // certify action below, never through a routine field edit.
    fields: ["bank", "currency", "mode", "specificationVersion", "notes", "active", "bbva"],
    searchFields: ["bank", "specificationVersion", "notes"],
    sortFields: ["bank", "currency", "mode", "active"],
    defaultSort: { bank: 1, currency: 1 },
    populate: [{ path: "certifiedBy", select: "name email role" }]
  }),
  certify: asyncHandler(async (req, res) => {
    const data = await certifyBankFormatConfiguration({
      id: req.params.id,
      certified: req.body.certified,
      certificationReference: req.body.certificationReference || req.body.comments,
      user: req.user,
      req
    });
    res.json({ data });
  })
};

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
