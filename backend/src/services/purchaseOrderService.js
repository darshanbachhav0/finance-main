import PurchaseOrder from "../models/PurchaseOrder.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { recordAudit } from "./auditService.js";
import { nextPurchaseOrderNumber } from "./sequenceService.js";
import { assertProcurementReady } from "./procurementReadinessService.js";
import { cancelPurchaseOrderBalance } from "./purchaseOrderMatchingService.js";
import { releaseUnexecutedCommitment } from "./budgetService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, PERMISSIONS } from "../utils/constants.js";
import { hasPermission } from "../utils/permissions.js";
import { normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";

export function selectedQuotationPaymentTerms(request) {
  const supplierId = String(request.supplier?._id || request.supplier || "");
  const selected = (request.quotations || []).filter((quotation) => quotation.recommended);
  if (!selected.length) return undefined;
  if (selected.length !== 1 || String(selected[0].supplier?._id || selected[0].supplier || "") !== supplierId) {
    throw new AppError(422, "The selected quotation must match the order supplier.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const quotation = selected[0];
  const errors = validatePaymentTerms(quotation);
  if (errors.length) throw new AppError(422, "Complete the selected quotation payment terms before issuing the order.", { errors }, ERROR_CODES.VALIDATION_ERROR);
  return {
    ...normalizePaymentTerms(quotation),
    sourceQuotation: quotation._id,
    quotationAmount: quotation.amount,
    quotationCurrency: quotation.currency || request.currency
  };
}

function lineSnapshot(line) {
  return {
    itemDescription: line.itemDescription,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure,
    unitPrice: line.unitPrice,
    priceIncludesIGV: line.priceIncludesIGV,
    netAmount: line.netAmount,
    igvAmount: line.igvAmount,
    total: line.commercialTotal ?? line.totalAmount,
    costCenterCode: line.costCenter?.code || line.costCenterSnapshot?.code,
    expenseAccount: line.expenseType?.accountNumber || line.expenseTypeSnapshot?.accountNumber
  };
}

export async function generatePurchaseOrder(request, user, req, { session, commitment } = {}) {
  const existing = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
  if (existing) return existing;
  const readiness = await assertProcurementReady(request, { session, commitment });
  await request.populate(["supplier", "lines.costCenter", "lines.expenseType"]);
  const paymentTermsSnapshot = selectedQuotationPaymentTerms(request);
  const poNumber = await nextPurchaseOrderNumber(request.issueDate);
  let purchaseOrder;
  try {
    [purchaseOrder] = await PurchaseOrder.create([{
      poNumber,
      request: request._id,
      supplier: request.supplier?._id || request.supplier,
      orderKind: readiness.orderKind,
      supplierCodeSnapshot: request.supplier.supplierCode,
      supplierSnapshot: {
        identifier: request.supplier.normalizedIdentifier || request.supplier.rucDni,
        legalName: request.supplier.legalName || request.supplier.name
      },
      lines: (request.lines || []).map(lineSnapshot),
      paymentTermsSnapshot,
      amount: request.totalAmount,
      originalAmount: request.totalAmount,
      consumedAmount: 0,
      remainingAmount: request.totalAmount,
      liquidatedInvoiceCount: 0,
      currency: request.currency,
      issueDate: new Date(),
      status: "ISSUED",
      generatedBy: user._id
    }], session ? { session } : undefined);
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
      if (concurrent) return concurrent;
    }
    throw error;
  }
  await recordAudit({
    entityType: "PurchaseOrder",
    entity: purchaseOrder,
    requestId: request._id,
    action: "ISSUED",
    user,
    req,
    module: "PURCHASE_ORDERS",
    newValues: {
      poNumber,
      orderKind: purchaseOrder.orderKind,
      supplier: purchaseOrder.supplier,
      supplierCode: purchaseOrder.supplierCodeSnapshot,
      amount: purchaseOrder.amount,
      currency: purchaseOrder.currency,
      paymentTermsSnapshot: purchaseOrder.paymentTermsSnapshot?.toObject()
    },
    session
  });
  return purchaseOrder;
}

// Invoicing is complete when the request is closed (CERRADO): by then every obligation is paid
// and reconciled, so no further invoice can be registered against the order. At that point the
// order's uninvoiced remainder is cancelled (status CLOSED) and the matching, never-executed part
// of the budget commitment is released back to its Cost Center / budget plan. Both movements are
// audited. Runs inside the closure transaction when one is available.
export async function settleProcurementAtClosure({ request, user, req, session }) {
  const reason = `Request ${request.requestNumber || request._id} closed: invoicing is complete.`;
  const order = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
  let orderResult = { changed: false, cancelledAmount: 0 };
  if (order) {
    orderResult = await cancelPurchaseOrderBalance(order._id, { status: "CLOSED", reason, userId: user._id, session });
    if (orderResult.changed) {
      await recordAudit({ entityType: "PurchaseOrder", entity: orderResult.order, requestId: request._id, action: "BALANCE_RELEASED_AT_CLOSURE", user, req, module: "PURCHASE_ORDERS", comments: reason,
        oldValues: orderResult.previous, newValues: { status: orderResult.order.status, remainingAmount: 0, cancelledAmount: orderResult.order.cancelledAmount, consumedAmount: orderResult.order.consumedAmount }, session });
    }
  }
  const budget = await releaseUnexecutedCommitment(request, user._id, reason, { session });
  if (budget.releasedAmount > 0) {
    await recordAudit({ entityType: "BudgetCommitment", entity: budget.commitment, requestId: request._id, action: "UNINVOICED_BUDGET_RELEASED", user, req, module: "BUDGET", comments: reason,
      newValues: { releasedAmount: budget.releasedAmount, status: budget.commitment?.status, totalAmount: budget.commitment?.totalAmount }, session });
  }
  return { purchaseOrder: orderResult.order || order || null, cancelledOrderAmount: orderResult.cancelledAmount, releasedBudgetAmount: budget.releasedAmount };
}

// A voided request will never be invoiced: its order (if any) is cancelled in full. The budget
// commitment itself is released by the void flow (releaseBudget).
export async function cancelProcurementOnVoid({ request, user, req, reason, session }) {
  const order = await PurchaseOrder.findOne({ request: request._id }).session(session || null);
  if (!order) return null;
  const result = await cancelPurchaseOrderBalance(order._id, { status: "CANCELLED", reason: reason || "Request voided.", userId: user._id, session });
  if (result.changed) {
    await recordAudit({ entityType: "PurchaseOrder", entity: result.order, requestId: request._id, action: "CANCELLED", user, req, module: "PURCHASE_ORDERS", comments: reason,
      oldValues: result.previous, newValues: { status: "CANCELLED", cancelledAmount: result.order.cancelledAmount }, session });
  }
  return result.order;
}

export async function issueProcurementOrder({ requestId, user, req }) {
  if (!hasPermission(user, PERMISSIONS.PROCUREMENT_ORDER_CREATE)) {
    throw new AppError(403, "You do not have permission to issue procurement orders.", undefined, ERROR_CODES.FORBIDDEN);
  }
  const request = await FinancialRequest.findById(requestId).populate("supplier");
  if (!request) throw new AppError(404, "Financial request not found.", { requestId }, ERROR_CODES.NOT_FOUND);
  const existing = await PurchaseOrder.findOne({ request: request._id });
  if (existing) return existing;
  return runFinancialOperation(async (session) => {
    const order = await generatePurchaseOrder(request, user, req, { session });
    request.purchaseOrder = order._id;
    await request.save({ session });
    return order;
  });
}
