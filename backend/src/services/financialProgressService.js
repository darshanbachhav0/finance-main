import FinancialRequest from "../models/FinancialRequest.js";
import InvoiceObservation from "../models/InvoiceObservation.js";
import BudgetException from "../models/BudgetException.js";
import "../models/PaymentBatch.js";
import "../models/JournalEntry.js";
import AccountsPayable from "../models/AccountsPayable.js";
import Reconciliation from "../models/Reconciliation.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import SunatVoucher from "../models/SunatVoucher.js";
import { deriveFinancialProgress, canonicalRequestStatus, isTerminalRequest } from "../../../shared/workflowStatus.mjs";
import { recordAudit, workflowEvent } from "./auditService.js";
import { guardAccountingPeriod } from "./periodService.js";
import { AppError } from "../utils/AppError.js";

export function assertRequestActive(request) {
  if (isTerminalRequest(request.status)) throw new AppError(409, "This request is terminal and cannot be changed.", { status: request.status }, "INVALID_STATUS_TRANSITION");
}
export async function assertPostingAllowed(request, { user, req, period } = {}) {
  assertRequestActive(request);
  const stored = await FinancialRequest.findById(request._id).select("status accountingPeriod fiscalData.fiscalPeriod").lean();
  if (stored) assertRequestActive(stored);
  for (const value of new Set([request.accountingPeriod, request.fiscalData?.fiscalPeriod, stored?.accountingPeriod, stored?.fiscalData?.fiscalPeriod, period].filter(Boolean))) {
    await guardAccountingPeriod({ period: value, action: "POST", user, req, module: "ACCOUNTING", entityType: "FinancialRequest", entityId: request._id, requestId: request._id });
  }
}
export async function getFinancialProgress(request, { session } = {}) {
  const [payables, reconciliations, order, vouchers] = await Promise.all([
    AccountsPayable.find({ request: request._id }).populate("paymentBatch").populate("provisionJournal", "status").populate("paymentJournal", "status").session(session || null).lean(),
    Reconciliation.find({ request: request._id }).session(session || null).lean(),
    PurchaseOrder.findOne({ request: request._id }).session(session || null).lean(),
    SunatVoucher.find({ request: request._id }).session(session || null).lean()
  ]);
  return deriveFinancialProgress(request, payables, reconciliations, order, vouchers);
}
export async function getFinancialProgressForRequests(requests) {
  const ids = requests.map(request => request._id);
  if (!ids.length) return new Map();
  const [payables, reconciliations, orders, vouchers] = await Promise.all([
    AccountsPayable.find({ request: { $in: ids } }).populate("paymentBatch").populate("provisionJournal", "status").populate("paymentJournal", "status").lean(),
    Reconciliation.find({ request: { $in: ids } }).lean(),
    PurchaseOrder.find({ request: { $in: ids } }).lean(),
    SunatVoucher.find({ request: { $in: ids } }).lean()
  ]);
  const group = rows => {
    const map = new Map();
    for (const row of rows) { const key = String(row.request); if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
    return map;
  };
  const ap = group(payables), rec = group(reconciliations), po = group(orders), voucher = group(vouchers);
  return new Map(requests.map(request => {
    const key = String(request._id);
    return [key, deriveFinancialProgress(request, ap.get(key), rec.get(key), po.get(key)?.[0], voucher.get(key))];
  }));
}
export async function syncFinancialProgress({ request, user, req, session, action = "FINANCIAL_PROGRESS_UPDATED" }) {
  assertRequestActive(request);
  await guardAccountingPeriod({ period: request.accountingPeriod, action: "UPDATE", user, req, module: "WORKFLOW", entityId: request._id, requestId: request._id });
  const progress = await getFinancialProgress(request, { session });
  const from = request.status;
  // A pending invoice is not yet an accounted obligation.
  const next = progress.status || (progress.counts.total && progress.unaccountedVouchers ? "COMPROMISO_PRESUPUESTAL" : null);
  if (next && from !== next) {
    request.status = next;
    request.workflowVersion = 2;
    request.approvalHistory.push(workflowEvent({ action, from, to: next, user, req, request, comments: "Derived from all active financial obligations." }));
  }
  await request.save({ session });
  if (next && from !== next) await recordAudit({ entityType: "FinancialRequest", entity: request, user, req, session, module: "WORKFLOW", action,
    oldValues: { status: from }, newValues: { status: next, counts: progress.counts } });
  return progress;
}
export async function assertClosureAllowed(request, { session } = {}) {
  assertRequestActive(request);
  const progress = await getFinancialProgress(request, { session });
  if (canonicalRequestStatus(request.status) !== "CONCILIADO" || progress.status !== "CONCILIADO") {
    throw new AppError(409, "Every active obligation must be paid and reconciled before closure.", progress, "INVALID_STATUS_TRANSITION");
  }
  if (progress.orderOpen) throw new AppError(409, "The purchase order still has an unconsumed balance.");
  const [invoiceObservation, budgetException] = await Promise.all([
    InvoiceObservation.exists({ request: request._id, resolutionStatus: "OPEN" }).session(session || null),
    BudgetException.exists({ request: request._id, status: "PENDING" }).session(session || null)
  ]);
  if (invoiceObservation || budgetException) throw new AppError(409, "Resolve pending invoice and budget observations before closure.");
  if (request.approvalRouteSnapshot?.some(step => step.required !== false && step.status !== "APPROVED")) throw new AppError(409, "Required approvals are incomplete.");
  if (request.observation?.code && !request.observation?.resolvedAt) throw new AppError(409, "Resolve the open observation before closure.");
  if ((request.flowType === "C" || request.requestType === "ENTREGA_RENDIR") &&
      (request.rendition?.status !== "VALIDATED" || Number(request.rendition?.balanceOutstanding || 0) !== 0)) {
    throw new AppError(422, "The advance must be fully rendered/returned and the rendition validated.", undefined, "RENDITION_REQUIRED");
  }
  if (Number(request.rendition?.nonDeductibleOutstanding || 0) > 0) throw new AppError(422, "Settle the outstanding rendition balance before closure.", undefined, "RENDITION_REQUIRED");
  return progress;
}
