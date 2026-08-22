import PurchaseOrder from "../models/PurchaseOrder.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { addMoney, roundMoney, subtractMoney } from "../utils/money.js";

function remainingOf(order) {
  const original = roundMoney(order.originalAmount ?? order.amount ?? 0);
  const consumed = roundMoney(order.consumedAmount || 0);
  return roundMoney(order.remainingAmount ?? subtractMoney(original, consumed));
}

export async function getPurchaseOrderBalance(purchaseOrderId, { session } = {}) {
  const order = await PurchaseOrder.findById(purchaseOrderId).session(session || null);
  if (!order) throw new AppError(404, "Purchase Order not found.", { purchaseOrderId }, ERROR_CODES.NOT_FOUND);
  return {
    purchaseOrder: order,
    originalAmount: roundMoney(order.originalAmount ?? order.amount),
    consumedAmount: roundMoney(order.consumedAmount || 0),
    remainingAmount: remainingOf(order),
    currency: order.currency,
    status: order.status
  };
}

export async function assertPurchaseOrderInvoiceFits(purchaseOrderId, amount, { currency, session } = {}) {
  const balance = await getPurchaseOrderBalance(purchaseOrderId, { session });
  const invoiceAmount = roundMoney(amount);
  if (!["ISSUED", "PARTIALLY_LIQUIDATED"].includes(balance.status)) {
    throw new AppError(409, "The Purchase Order is not available for invoice matching.", { status: balance.status }, ERROR_CODES.PURCHASE_ORDER_EXHAUSTED);
  }
  if (currency && balance.currency !== currency) {
    throw new AppError(422, "Invoice currency does not match the Purchase Order.", { purchaseOrderCurrency: balance.currency, invoiceCurrency: currency }, ERROR_CODES.VALIDATION_ERROR);
  }
  if (!(invoiceAmount > 0)) throw new AppError(422, "Invoice amount must be greater than zero.", { amount }, ERROR_CODES.VALIDATION_ERROR);
  if (invoiceAmount > balance.remainingAmount) {
    throw new AppError(
      422,
      "Invoice amount exceeds the remaining Purchase Order ceiling.",
      { invoiceAmount, remainingAmount: balance.remainingAmount, purchaseOrder: balance.purchaseOrder._id },
      ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED
    );
  }
  return { ...balance, invoiceAmount };
}

export async function consumePurchaseOrderBalance(purchaseOrderId, amount, { session } = {}) {
  const invoiceAmount = roundMoney(amount);
  const balance = await assertPurchaseOrderInvoiceFits(purchaseOrderId, invoiceAmount, { session });
  const updated = await PurchaseOrder.findOneAndUpdate(
    { _id: purchaseOrderId, remainingAmount: { $gte: invoiceAmount }, status: { $in: ["ISSUED", "PARTIALLY_LIQUIDATED"] } },
    {
      $inc: { consumedAmount: invoiceAmount, remainingAmount: -invoiceAmount, liquidatedInvoiceCount: 1 }
    },
    { new: true, session: session || undefined }
  );
  if (!updated) {
    throw new AppError(
      409,
      "Purchase Order balance changed while matching this invoice. Retry the operation.",
      { requiredAmount: invoiceAmount, previousRemaining: balance.remainingAmount },
      ERROR_CODES.PURCHASE_ORDER_AMOUNT_EXCEEDED
    );
  }
  updated.remainingAmount = Math.max(0, roundMoney(updated.remainingAmount));
  updated.consumedAmount = addMoney(0, updated.consumedAmount);
  updated.status = updated.remainingAmount <= 0 ? "LIQUIDATED" : "PARTIALLY_LIQUIDATED";
  await updated.save({ session });
  return updated;
}

export async function restorePurchaseOrderBalance(purchaseOrderId, amount, { session } = {}) {
  const invoiceAmount = roundMoney(amount);
  const order = await PurchaseOrder.findById(purchaseOrderId).session(session || null);
  if (!order || !(invoiceAmount > 0)) return order;
  order.consumedAmount = Math.max(0, subtractMoney(order.consumedAmount || 0, invoiceAmount));
  order.remainingAmount = Math.min(roundMoney(order.originalAmount ?? order.amount), addMoney(order.remainingAmount || 0, invoiceAmount));
  order.liquidatedInvoiceCount = Math.max(0, Number(order.liquidatedInvoiceCount || 0) - 1);
  order.status = order.consumedAmount > 0 ? "PARTIALLY_LIQUIDATED" : "ISSUED";
  await order.save({ session });
  return order;
}
