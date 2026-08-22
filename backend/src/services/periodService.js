import AccountingPeriod from "../models/AccountingPeriod.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";
import { CLOSED_PERIOD_MESSAGE, ERROR_CODES } from "../utils/constants.js";

const policyFieldByAction = Object.freeze({
  CREATE: "blockCreate",
  UPDATE: "blockUpdate",
  DELETE: "blockDelete",
  SUBMIT: "blockUpdate",
  APPROVE: "blockApproval",
  OBSERVE: "blockApproval",
  RETURN: "blockApproval",
  REJECT: "blockApproval",
  ACCOUNT: "blockPosting",
  POST: "blockPosting",
  SCHEDULE: "blockPayment",
  GENERATE_BANK_FILE: "blockPayment",
  CONFIRM_PAYMENT: "blockPayment",
  RECONCILE: "blockPayment",
  RENDITION: "blockRendition",
  VOID: "blockVoid",
  CLOSE: "blockClose"
});

async function auditBlockedAttempt(period, action, context, reason) {
  try {
    await recordAudit({
      entityType: context.entityType || "FinancialRequest",
      entity: context.entityId || context.requestId || context.user?._id,
      requestId: context.requestId,
      action: `BLOCKED_${action}`,
      user: context.user,
      req: context.req,
      module: context.module || "ACCOUNTING_PERIOD",
      message: CLOSED_PERIOD_MESSAGE,
      blocked: true,
      blockReason: reason,
      period,
      changes: { attemptedAction: action }
    });
  } catch (error) {
    // A blocked financial action must remain blocked even if audit persistence is unavailable.
    console.error("Unable to persist blocked-period audit", error.message);
  }
}

export async function guardAccountingPeriod({
  period,
  action = "UPDATE",
  user,
  req,
  module,
  entityType,
  entityId,
  requestId,
  requireExisting = true
}) {
  const normalizedPeriod = String(period || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalizedPeriod)) {
    throw new AppError(422, "A valid accounting period is required.", { period }, ERROR_CODES.VALIDATION_ERROR);
  }

  const accountingPeriod = await AccountingPeriod.findOne({ period: normalizedPeriod });
  const context = { user, req, module, entityType, entityId, requestId };
  if (!accountingPeriod && requireExisting) {
    await auditBlockedAttempt(normalizedPeriod, action, context, "ACCOUNTING_PERIOD_MISSING");
    throw new AppError(
      422,
      `Accounting period ${normalizedPeriod} has not been configured.`,
      { period: normalizedPeriod, attemptedAction: action },
      ERROR_CODES.ACCOUNTING_PERIOD_MISSING
    );
  }

  const policyField = policyFieldByAction[action] || "blockUpdate";
  const blockedByPolicy = accountingPeriod?.policy?.[policyField] !== false;
  if (accountingPeriod?.status === "CLOSED" && blockedByPolicy) {
    await auditBlockedAttempt(normalizedPeriod, action, context, "ACCOUNTING_PERIOD_CLOSED");
    throw new AppError(
      423,
      CLOSED_PERIOD_MESSAGE,
      { period: normalizedPeriod, attemptedAction: action },
      ERROR_CODES.ACCOUNTING_PERIOD_CLOSED
    );
  }
  return accountingPeriod;
}

export function ensurePeriodOpen(period, context = {}) {
  return guardAccountingPeriod({ period, ...context });
}

export function periodFromDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
