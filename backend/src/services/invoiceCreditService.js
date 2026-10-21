import AccountsPayable from "../models/AccountsPayable.js";
import { AP_STATUS, ROLES } from "../utils/constants.js";
import { AppError } from "../utils/AppError.js";
import { invoiceDueDate } from "../../../shared/invoiceFinance.mjs";
import { recordAudit } from "./auditService.js";
import { runFinancialOperation } from "./transactionService.js";

export async function updateInvoiceCredit({ id, payload, user, req }) {
  if (![ROLES.ADMIN, ROLES.ACCOUNTING].includes(user.role)) throw new AppError(403, "Accounting permission is required.");
  const days = payload.creditDays;
  if (!["number", "string"].includes(typeof days) || String(days).trim() === "" || !Number.isSafeInteger(Number(days)) || Number(days) < 0 || Number(days) > 36500) throw new AppError(422, "Ingrese días de crédito enteros entre 0 y 36500.");
  const reason = String(payload.reason || "").trim();
  if (!reason || reason.length > 2000) throw new AppError(422, "Indique el motivo del cambio de condiciones (máximo 2000 caracteres).");
  return runFinancialOperation(async session => {
    const payable = await AccountsPayable.findById(id).session(session || null);
    if (!payable) throw new AppError(404, "Accounts payable not found.");
    if (payable.flowType === "C" || ![AP_STATUS.OPEN, AP_STATUS.PARTIALLY_PAID].includes(payable.status)) throw new AppError(409, "Solo se pueden modificar facturas pendientes sin instrucción bancaria activa.");
    const oldValues = { dueDate: payable.dueDate, paymentTermsSnapshot: payable.paymentTermsSnapshot?.toObject() };
    const key = payload.dueDate ? invoiceDueDate(payload.dueDate, { option: "CASH" }) : invoiceDueDate(payable.voucher?.documentDate, { option: "CUSTOM", days: Number(days) });
    if (!key) throw new AppError(422, "Ingrese una fecha de vencimiento válida o complete la fecha de emisión.");
    const terms = Number(days) === 0 ? { option: "CASH", days: 0 } : { paymentCondition: "CREDIT", creditDays: Number(days), creditStart: "INVOICE" };
    payable.paymentTermsSnapshot = { ...terms, source: "INVOICE_OVERRIDE", supplier: payable.supplier, capturedAt: new Date() };
    payable.dueDate = new Date(`${key}T00:00:00.000Z`);
    payable.history.push({ status: payable.status, by: user._id, comments: `Condiciones de factura actualizadas: ${reason}` });
    await payable.save({ session });
    await recordAudit({ entityType: "AccountsPayable", entity: payable, requestId: payable.request, action: "INVOICE_CREDIT_UPDATED", module: "ACCOUNTING", user, req, session, comments: reason, oldValues, newValues: { dueDate: payable.dueDate, paymentTermsSnapshot: payable.paymentTermsSnapshot?.toObject() } });
    return payable;
  });
}
