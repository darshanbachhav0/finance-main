import PurchaseOrder from "../models/PurchaseOrder.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { recordAudit } from "./auditService.js";
import { nextPurchaseOrderNumber } from "./sequenceService.js";
import { assertProcurementReady } from "./procurementReadinessService.js";
import { runFinancialOperation } from "./transactionService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, PERMISSIONS } from "../utils/constants.js";
import { hasPermission } from "../utils/permissions.js";

function lineSnapshot(line) {
  return {
    itemDescription: line.itemDescription,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure,
    unitPrice: line.unitPrice,
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
      currency: purchaseOrder.currency
    },
    session
  });
  return purchaseOrder;
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
