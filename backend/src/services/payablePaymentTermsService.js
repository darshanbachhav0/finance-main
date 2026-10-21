import PurchaseOrder from "../models/PurchaseOrder.js";
import { selectedQuotationPaymentTerms } from "./purchaseOrderService.js";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, FLOW_TYPE } from "../utils/constants.js";
import { invoiceDueDate } from "../../../shared/invoiceFinance.mjs";

const hasTerms = value => Boolean(value?.paymentCondition || value?.paymentConditions?.trim() || value?.paymentNotes?.trim());

export function capturePayablePaymentTerms({ request, supplier, purchaseOrder }) {
  const supplierId = supplier?._id || supplier || request.supplier?._id || request.supplier;
  // An existing order is authoritative even if it predates structured terms.
  // Do not reinterpret it using a quotation edited after issuance.
  const quoted = purchaseOrder ? purchaseOrder.paymentTermsSnapshot : selectedQuotationPaymentTerms(request);
  const terms = hasTerms(quoted) ? quoted : !purchaseOrder ? request.supplierPaymentTerms : undefined;
  if (hasTerms(terms)) {
    const errors = validatePaymentTerms(terms);
    if (errors.length) throw new AppError(422, "Review the quotation payment terms.", { errors }, ERROR_CODES.VALIDATION_ERROR);
    return {
      ...normalizePaymentTerms(terms),
      source: purchaseOrder ? "PURCHASE_ORDER" : (request.quotations || []).some(item => item.recommended) ? "QUOTATION" : "REQUEST",
      sourceQuotation: terms.sourceQuotation,
      quotationAmount: terms.quotationAmount,
      quotationCurrency: terms.quotationCurrency,
      supplier: supplierId,
      capturedAt: new Date()
    };
  }
  if (Number.isSafeInteger(request.supplierCreditDaysSnapshot) && request.supplierCreditDaysSnapshot >= 0) return {
    option: request.supplierCreditDaysSnapshot === 0 ? "CASH" : [15, 30, 45, 60].includes(request.supplierCreditDaysSnapshot) ? `CREDIT_${request.supplierCreditDaysSnapshot}` : "CUSTOM",
    days: request.supplierCreditDaysSnapshot,
    source: "SUPPLIER_DEFAULT", supplier: supplierId, capturedAt: new Date()
  };
  if (supplier?.paymentTerms?.option) return {
    option: supplier.paymentTerms.option,
    days: supplier.paymentTerms.days,
    source: "SUPPLIER_DEFAULT",
    supplier: supplierId,
    capturedAt: new Date()
  };
  return undefined;
}

export async function resolvePayablePaymentTerms({ request, supplier, purchaseOrder, session }) {
  let order = purchaseOrder;
  if (order && !order.request) order = await PurchaseOrder.findById(order._id || order).session(session || null);
  if (!order) order = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
  return capturePayablePaymentTerms({ request, supplier, purchaseOrder: order });
}

export function resolvePayableDueDate({ dueDate, voucher, paymentTermsSnapshot, flowType }) {
  if (dueDate) {
    const explicit = new Date(dueDate);
    if (Number.isNaN(explicit.getTime()) || (typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !invoiceDueDate(dueDate, { option: "CASH" }))) throw new AppError(422, "Enter a valid due date.", undefined, ERROR_CODES.VALIDATION_ERROR);
    return explicit;
  }
  const issueDate = new Date(voucher?.issueDate || voucher?.documentDate || Date.now());
  if (Number.isNaN(issueDate.getTime())) throw new AppError(422, "Enter a valid invoice date.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const terms = paymentTermsSnapshot;
  if (hasTerms(terms)) {
    const calculated = invoiceDueDate(voucher?.issueDate || voucher?.documentDate, terms);
    if (calculated) return new Date(`${calculated}T00:00:00.000Z`);
    // A document upload date is not a delivery/conformity date. Split/custom
    // agreements have no single automatic maturity date for the entire invoice.
    return undefined;
  }
  const calculated = invoiceDueDate(voucher?.issueDate || voucher?.documentDate, terms);
  if (calculated) return new Date(`${calculated}T00:00:00.000Z`);
  if ([FLOW_TYPE.B, FLOW_TYPE.C].includes(flowType)) return issueDate;
  // A1 invoices without known terms have no inferred contractual maturity.
  return undefined;
}
