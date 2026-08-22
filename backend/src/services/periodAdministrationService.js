import AccountingPeriod from "../models/AccountingPeriod.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { getConsolidation } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { moneyEquals } from "../utils/money.js";

const terminalStatuses = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED];

export async function createAccountingPeriod({ payload, user, req }) {
  const period = String(payload.period || "").trim();
  if (!/^\d{4}-\d{2}$/.test(period)) throw new AppError(422, "A valid YYYY-MM accounting period is required.", { period }, ERROR_CODES.VALIDATION_ERROR);
  const existing = await AccountingPeriod.findOne({ period });
  if (existing) throw new AppError(409, "Accounting period already exists.", { period }, ERROR_CODES.CONFLICT);
  const now = new Date();
  const record = await AccountingPeriod.create({
    period,
    status: "OPEN",
    openedAt: now,
    openedBy: user._id,
    comments: payload.comments,
    policy: payload.policy,
    history: [{ action: "CREATED", at: now, by: user._id, comments: payload.comments }]
  });
  await recordAudit({ entityType: "AccountingPeriod", entity: record, action: "CREATED", user, req, module: "ACCOUNTING_PERIOD", newValues: { period, status: record.status } });
  return record;
}

export async function closeAccountingPeriod({ id, comments, force, overrideReason, user, req }) {
  const period = await AccountingPeriod.findById(id);
  if (!period) throw new AppError(404, "Accounting period not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (period.status === "CLOSED") return period;
  if (!String(comments || "").trim()) throw new AppError(422, "Closing comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const [openTransactions, consolidation] = await Promise.all([
    FinancialRequest.countDocuments({ accountingPeriod: period.period, status: { $nin: terminalStatuses } }),
    getConsolidation(period.period)
  ]);
  const blockers = {
    openTransactions,
    sourceDifference: consolidation.summary.difference,
    journalBalanced: consolidation.summary.balanced
  };
  const hasBlockers = openTransactions > 0 || !moneyEquals(consolidation.summary.difference, 0) || !consolidation.summary.balanced;
  const override = force === true || force === "true";
  if (hasBlockers && (!override || user.role !== ROLES.ADMIN || !String(overrideReason || "").trim())) {
    throw new AppError(409, "The period cannot be closed until open transactions and accounting differences are resolved.", blockers, ERROR_CODES.VALIDATION_ERROR);
  }
  const now = new Date();
  period.status = "CLOSED";
  period.closedAt = now;
  period.closingDate = now;
  period.closedBy = user._id;
  period.comments = comments;
  period.history.push({ action: "CLOSED", at: now, by: user._id, comments: override ? `${comments} Override: ${overrideReason}` : comments, override });
  await period.save();
  await recordAudit({
    entityType: "AccountingPeriod",
    entity: period,
    action: override ? "CLOSED_WITH_ADMIN_OVERRIDE" : "CLOSED",
    user,
    req,
    module: "ACCOUNTING_PERIOD",
    comments,
    oldValues: { status: "OPEN" },
    newValues: { status: "CLOSED", blockers, override, overrideReason }
  });
  return period;
}

export async function reopenAccountingPeriod({ id, comments, user, req }) {
  const period = await AccountingPeriod.findById(id);
  if (!period) throw new AppError(404, "Accounting period not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (period.status === "OPEN") return period;
  if (!String(comments || "").trim()) throw new AppError(422, "Reopening comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const now = new Date();
  period.status = "OPEN";
  period.reopenedAt = now;
  period.reopenedBy = user._id;
  period.openedAt = now;
  period.openedBy = user._id;
  period.comments = comments;
  period.history.push({ action: "REOPENED", at: now, by: user._id, comments });
  await period.save();
  await recordAudit({ entityType: "AccountingPeriod", entity: period, action: "REOPENED", user, req, module: "ACCOUNTING_PERIOD", comments, oldValues: { status: "CLOSED" }, newValues: { status: "OPEN" } });
  return period;
}

