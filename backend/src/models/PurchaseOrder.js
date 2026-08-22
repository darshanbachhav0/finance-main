import mongoose from "mongoose";
import { CURRENCY, PROCUREMENT_ORDER_KINDS } from "../utils/constants.js";

const orderLineSchema = new mongoose.Schema(
  {
    itemDescription: String,
    quantity: Number,
    unitOfMeasure: String,
    unitPrice: Number,
    total: Number,
    costCenterCode: String,
    expenseAccount: String
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, immutable: true },
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    orderKind: { type: String, enum: PROCUREMENT_ORDER_KINDS },
    supplierCodeSnapshot: { type: String, trim: true },
    supplierSnapshot: {
      identifier: String,
      legalName: String
    },
    lines: { type: [orderLineSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    originalAmount: { type: Number, min: 0 },
    consumedAmount: { type: Number, default: 0, min: 0 },
    remainingAmount: { type: Number, min: 0 },
    liquidatedInvoiceCount: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: CURRENCY, required: true },
    issueDate: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: ["DRAFT", "ISSUED", "PARTIALLY_LIQUIDATED", "LIQUIDATED", "CANCELLED"], default: "ISSUED", index: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fileName: String,
    url: String
  },
  { timestamps: true }
);

purchaseOrderSchema.pre("validate", function maintainBalances() {
  const original = Number(this.originalAmount ?? this.amount ?? 0);
  const consumed = Number(this.consumedAmount || 0);
  this.originalAmount = original;
  this.amount = original;
  this.remainingAmount = Math.max(0, Number((original - consumed).toFixed(2)));
  if (this.status !== "CANCELLED" && this.status !== "DRAFT") {
    this.status = this.remainingAmount <= 0 ? "LIQUIDATED" : consumed > 0 ? "PARTIALLY_LIQUIDATED" : "ISSUED";
  }
});

purchaseOrderSchema.index({ status: 1, remainingAmount: 1, issueDate: -1 });

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);
