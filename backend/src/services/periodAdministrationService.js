import AccountingPeriod from "../models/AccountingPeriod.js";
import AccountsPayable from "../models/AccountsPayable.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import JournalEntry from "../models/JournalEntry.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { getConsolidation } from "./accountingService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { AP_STATUS, ERROR_CODES } from "../utils/constants.js";
import { moneyEquals } from "../utils/money.js";

function periodRange(period) {
  const [year, month] = period.split("-").map(Number);
  return { $gte: new Date(Date.UTC(year, month - 1, 1)), $lt: new Date(Date.UTC(year, month, 1)) };
}

// Month-end close is blocked only by genuinely unposted or incomplete accounting items dated in the
// period. Approved, posted invoices that are still unpaid are ordinary outstanding AP and do not
// block the close; the request's creation month is irrelevant.
export async function periodCloseBlockers(period) {
  const dated = periodRange(period);
  const [unpostedInvoices, openInvoiceObservations, incompletePayables, draftJournals] = await Promise.all([
    // Invoice/note evidence dated in the period that never reached a posted CXP or adjustment.
    SunatVoucher.countDocuments({
      issueDate: dated,
      validationStatus: { $ne: "ANNULLED" },
      supersededBy: null,
      $or: [
        { voucherType: { $nin: ["NOTA_CREDITO", "NOTA_DEBITO"] }, accountsPayable: null },
        { voucherType: { $in: ["NOTA_CREDITO", "NOTA_DEBITO"] }, adjustmentAppliedAt: null }
      ]
    }),
    InvoiceObservation.countDocuments({ issueDate: dated, resolutionStatus: "OPEN" }),
    AccountsPayable.countDocuments({ accountingPeriod: period, status: { $ne: AP_STATUS.CANCELLED }, provisionJournal: null }),
    JournalEntry.countDocuments({ period, status: "DRAFT" })
  ]);
  return { unpostedInvoices, openInvoiceObservations, incompletePayables, draftJournals };
}

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

export async function closeAccountingPeriod({ id, comments, force, user, req }) {
  const period = await AccountingPeriod.findById(id);
  if (!period) throw new AppError(404, "Accounting period not found.", { id }, ERROR_CODES.NOT_FOUND);
  if (period.status === "CLOSED") return period;
  if (!String(comments || "").trim()) throw new AppError(422, "Closing comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const [pending, consolidation] = await Promise.all([
    periodCloseBlockers(period.period),
    getConsolidation(period.period)
  ]);
  const blockers = {
    ...pending,
    openTransactions: pending.unpostedInvoices + pending.openInvoiceObservations + pending.incompletePayables + pending.draftJournals,
    sourceDifference: consolidation.summary.difference,
    journalBalanced: consolidation.summary.balanced
  };
  const hasBlockers = blockers.openTransactions > 0 || !moneyEquals(consolidation.summary.difference, 0) || !consolidation.summary.balanced;
  const override = force === true || force === "true";
  if (override) throw new AppError(403, "Forced period closure is disabled. Resolve financial blockers before closing the period.");
  if (hasBlockers) {
    throw new AppError(409, "The period cannot be closed until its unposted invoices, open invoice observations, incomplete payables and accounting differences are resolved. Posted invoices that are simply unpaid do not block the close.", blockers, ERROR_CODES.VALIDATION_ERROR);
  }
  const now = new Date();
  period.status = "CLOSED";
  period.closedAt = now;
  period.closingDate = now;
  period.closedBy = user._id;
  period.comments = comments;
  period.history.push({ action: "CLOSED", at: now, by: user._id, comments, override: false });
  await period.save();
  await recordAudit({
    entityType: "AccountingPeriod",
    entity: period,
    action: "CLOSED",
    user,
    req,
    module: "ACCOUNTING_PERIOD",
    comments,
    oldValues: { status: "OPEN" },
    newValues: { status: "CLOSED", blockers, override: false }
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
