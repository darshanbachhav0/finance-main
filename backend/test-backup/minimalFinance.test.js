import "./isolateEnv.js";
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import CostCenter from "../src/models/CostCenter.js";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import AuditLog from "../src/models/AuditLog.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import ExpenseType from "../src/models/ExpenseType.js";
import { invoiceDueDate, invoiceStatus, supplierCreditDays } from "../../shared/invoiceFinance.mjs";
import { limaToday } from "../../shared/businessCalendar.mjs";
import { paymentBreakdown } from "../../shared/paymentTerms.mjs";
import { capturePayablePaymentTerms, resolvePayableDueDate } from "../src/services/payablePaymentTermsService.js";
import { createFinancialRequest, updateFinancialRequest, parseSupplierPaymentTerms } from "../src/services/requestService.js";
import { assertStoredAssetAccess } from "../src/services/fileAccessService.js";

test("credit maturity uses calendar days, preserves agreed dates and never invents milestones", () => {
  assert.equal(invoiceDueDate("2026-11-01", { option: "CREDIT_30" }), "2026-12-01");
  assert.equal(invoiceDueDate("2028-02-28", { option: "CREDIT_15" }), "2028-03-14");
  assert.equal(invoiceDueDate("2026-12-31", { option: "CASH" }), "2026-12-31");
  assert.equal(invoiceDueDate("2026-11-01T02:00:00Z", { option: "CREDIT_30" }), "2026-11-30");
  assert.equal(invoiceDueDate("2026-02-30", { option: "CREDIT_30" }), null);
  assert.equal(invoiceDueDate("2026-11-01", { paymentCondition: "CREDIT", creditStart: "CONFORMITY", creditDays: 30 }), null);
  assert.equal(invoiceDueDate(undefined, { option: "CREDIT_30" }), null);
  assert.equal(invoiceDueDate("2026-11-01", { option: "CUSTOM", days: Number.MAX_SAFE_INTEGER }), null);
  assert.equal(supplierCreditDays({ option: "CUSTOM", days: true }), null);
  assert.equal(resolvePayableDueDate({ voucher: { issueDate: "2026-11-01" }, paymentTermsSnapshot: { option: "CREDIT_60" }, flowType: "B" }).toISOString().slice(0, 10), "2026-12-31");
  assert.equal(resolvePayableDueDate({ dueDate: "2026-11-20", voucher: { issueDate: "2026-11-01" }, paymentTermsSnapshot: { option: "CREDIT_30" } }).toISOString().slice(0, 10), "2026-11-20");
  assert.equal(resolvePayableDueDate({ voucher: { issueDate: "2026-11-01" }, flowType: "A1" }), undefined);
  assert.throws(() => resolvePayableDueDate({ dueDate: "2026-02-30" }));
});

test("supplier advance terms derive cents on the server and preserve frozen order authority", () => {
  const terms = parseSupplierPaymentTerms({ paymentCondition: "ADVANCE_AND_BALANCE", advancePercentage: 30, balanceTiming: "ON_DELIVERY", advanceAmount: 1, balanceAmount: 99999 });
  assert.deepEqual(paymentBreakdown(terms, 10000), { advancePercentage: 30, balancePercentage: 70, advanceAmount: 3000, balanceAmount: 7000 });
  assert.equal(terms.advanceAmount, undefined);
  const exact = { ...terms, plannedAdvanceAmount: 3333.33 };
  assert.equal(paymentBreakdown(exact, 10000).advanceAmount, 3333.33);
  assert.equal(paymentBreakdown(exact, 10000).balanceAmount, 6666.67);
  assert.equal(paymentBreakdown({ ...terms, plannedAdvanceAmount: 10001 }, 10000), null);
  assert.throws(() => parseSupplierPaymentTerms({ ...terms, advancePercentage: 101 }));
  assert.throws(() => parseSupplierPaymentTerms({ ...terms, advancePercentage: -1 }));
  const supplier = { _id: new mongoose.Types.ObjectId(), paymentTerms: { option: "CREDIT_60", days: 60 } };
  const request = { supplier: supplier._id, supplierPaymentTerms: terms, quotations: [] };
  const captured = capturePayablePaymentTerms({ request, supplier });
  assert.equal(captured.source, "REQUEST");
  assert.equal(captured.advancePercentage, 30);
  const frozen = capturePayablePaymentTerms({ request, supplier, purchaseOrder: { paymentTermsSnapshot: { paymentCondition: "CREDIT", creditDays: 15, creditStart: "INVOICE" } } });
  assert.equal(frozen.creditDays, 15);
  assert.equal(frozen.source, "PURCHASE_ORDER");
});

test("invoice states retain partial balances and evaluate the Lima business day", () => {
  const now = new Date("2026-11-02T03:00:00Z"); // Still November 1 in Lima.
  assert.equal(invoiceStatus({ status: "PARTIALLY_PAID", outstandingAmount: 700, dueDate: "2026-11-01" }, now), "Por vencer");
  assert.equal(invoiceStatus({ status: "PARTIALLY_PAID", outstandingAmount: 700, dueDate: "2026-10-31" }, now), "Vencida");
  assert.equal(invoiceStatus({ status: "PAID", outstandingAmount: 0, dueDate: "2026-10-31" }, now), "Pagada");
});

test("Jefe API uses departmental ledgers, real approval rows, invoice filters and document permissions", { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_minimal_finance_${process.pid}_${Date.now()}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.on("listening", resolve));
  try {
    const today = limaToday(), year = today.slice(0, 4);
    const offset = days => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000);
    const jefe = await User.create({ name: "Jefe UMA", passwordHash: "unused", role: "Solicitor", area: "Laboratorios" });
    const owner = await User.create({ name: "Solicitante UMA", passwordHash: "unused", role: "Solicitor", area: "Laboratorios", jefe: jefe._id });
    const outsider = await User.create({ name: "Otra área", passwordHash: "unused", role: "Solicitor", area: "Otra" });
    const supplier = await Supplier.create({ rucDni: "20777999123", legalName: "Proveedor UMA", name: "Proveedor UMA", paymentTerms: { option: "CREDIT_15", days: 99 } });
    assert.equal((await Supplier.findById(supplier._id)).paymentTerms.days, 15);
    await assert.rejects(() => Supplier.create({ rucDni: "20777999124", name: "Inválido", paymentTerms: { option: "CUSTOM", days: 1.5 } }));
    const [center, otherCenter] = await CostCenter.create([{ code: "LAB", name: "Laboratorio", area: "Laboratorios" }, { code: "OTHER", name: "Otro", area: "Otra" }]);
    owner.costCenter = center._id;
    await owner.save();
    await AccountingPeriod.create({ period: today.slice(0, 7), status: "OPEN" });
    const expense = await ExpenseType.create({ code: "EXP-LAB", name: "Servicios", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const draft = await createFinancialRequest({ payload: {
      flowType: "A1", requestType: "OPEX", expenseNature: "SERVICES", issueDate: today, accountingPeriod: today.slice(0, 7), currency: "PEN", requesterCostCenter: String(center._id), supplier: String(supplier._id),
      description: "Mantenimiento", detailedDescription: "Mantenimiento de laboratorio", businessJustification: "Continuidad de clases", submit: "false",
      supplierPaymentTerms: JSON.stringify({ paymentCondition: "ADVANCE_AND_BALANCE", advancePercentage: 30, plannedAdvanceAmount: 3333.33, balanceTiming: "ON_DELIVERY" }),
      lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(expense._id), itemDescription: "Servicio", quantity: 1, unitPrice: 10000, unitOfMeasure: "SERVICE", priceIncludesIGV: true }])
    }, user: owner, files: {}, req: { headers: {}, ip: "127.0.0.1" } });
    const restored = await FinancialRequest.findById(draft._id);
    assert.equal(restored.supplierCreditDaysSnapshot, 15);
    assert.equal(restored.supplierPaymentTerms.advancePercentage, 33.3333);
    assert.equal(paymentBreakdown(restored.supplierPaymentTerms, restored.totalAmount).advanceAmount, 3333.33);
    assert.equal(await AccountsPayable.countDocuments({ request: restored._id }), 0, "A planned supplier advance is not a confirmed payment or employee advance");
    restored.supplierPaymentTerms.plannedAdvanceAmount = 10000.01;
    await assert.rejects(() => restored.validate(), error => Boolean(error.errors?.["supplierPaymentTerms.plannedAdvanceAmount"]));
    await updateFinancialRequest({ id: draft._id, payload: { supplierPaymentTerms: JSON.stringify({ paymentCondition: "100%_ADVANCE" }) }, files: {}, user: owner, req: { headers: {}, ip: "127.0.0.1" } });
    const termsAudit = await AuditLog.findOne({ entityId: draft._id, action: "UPDATED" });
    assert.equal(termsAudit.oldValues.officialRequest.supplierPaymentTerms.plannedAdvanceAmount, 3333.33);
    assert.equal(termsAudit.newValues.officialRequest.supplierPaymentTerms.paymentCondition, "100%_ADVANCE");
    await BudgetAllocation.create([
      { costCenter: center._id, period: year, assignedAmount: 100000, committedAmount: 20000, executedAmount: 30000, paidAmount: 10000 },
      { costCenter: otherCenter._id, period: year, assignedAmount: 900000, committedAmount: 800000 }
    ]);
    const requestId = new mongoose.Types.ObjectId(), hiddenId = new mongoose.Types.ObjectId();
    await FinancialRequest.collection.insertMany([
      { _id: requestId, requestNumber: "SOL-MINIMAL-1", supplier: supplier._id, requester: owner._id, solicitor: owner._id, requesterArea: owner.area, currency: "PEN", totalAmount: 1000, totalPENEquivalent: 1000, status: "PENDIENTE_APROBACION", approvalStage: "AREA_DIRECTOR", createdAt: new Date(), approvalRouteSnapshot: [{ sequence: 1, required: true, status: "PENDING", source: "MANAGER_CHAIN", approverUser: jefe._id }] },
      { _id: hiddenId, requestNumber: "SOL-HIDDEN", requester: outsider._id, solicitor: outsider._id, requesterArea: "Otra", supplier: supplier._id, status: "APROBADO" }
    ]);
    const payable = (id, number, extra = {}) => ({ request: id, supplier: supplier._id, supplierIdentifierSnapshot: "20777999123", currency: "PEN", exchangeRate: 1, penEquivalent: 1000, originalAmount: 1000, outstandingAmount: 700, status: "PARTIALLY_PAID", flowType: "A1", voucher: { voucherType: "01", series: "F001", number, documentDate: offset(-30) }, dueDate: offset(-1), paymentTermsSnapshot: { option: "CREDIT_15", days: 15 }, ...extra });
    const partial = await AccountsPayable.create(payable(requestId, "1", { plannedPaymentDate: offset(3) }));
    await AccountsPayable.create([
      payable(requestId, "2", { dueDate: offset(3), status: "OPEN", outstandingAmount: 1000 }),
      payable(requestId, "3", { status: "PAID", outstandingAmount: 0 }),
      payable(hiddenId, "4"), payable(requestId, "5", { status: "CANCELLED" }),
      payable(requestId, "6", { flowType: "C" })
    ]);
    const call = async (user, path, method = "GET", body) => {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    };
    const dashboard = await call(jefe, "/dashboard/summary");
    assert.equal(dashboard.status, 200);
    const data = dashboard.body.jefe;
    assert.deepEqual([data.totals.assigned, data.totals.committed, data.totals.executed, data.totals.available], [100000, 20000, 30000, 50000]);
    assert.equal(data.progress, 30);
    assert.deepEqual(data.invoiceAlerts, { overdue: 1, dueSoon: 1 });
    assert.equal(data.approvals.length, 1);
    assert.equal(data.approvals[0].requester.name, owner.name);
    assert.equal(data.approvals[0].scheduledPaymentDate.slice(0, 10), offset(3).toISOString().slice(0, 10));
    const invoices = await call(jefe, "/dashboard/invoices?state=due&pageSize=1");
    assert.equal(invoices.body.pagination.total, 2);
    assert.equal(invoices.body.data[0].outstandingAmount, 700);
    assert.equal(invoices.body.data[0].invoiceState, "Vencida");
    assert.equal(invoices.body.data[0].bankAccountSnapshot, undefined);
    assert.equal((await call(outsider, "/dashboard/invoices")).status, 403);
    assert.equal((await call(jefe, "/treasury/schedule", "POST", { accountsPayableIds: [String(partial._id)], paymentDate: today })).status, 403);
    const asset = { kind: "uploads", segments: ["suppliers", String(supplier._id), "evidence.pdf"] };
    await assertStoredAssetAccess(asset, jefe, { requestId });
    await assert.rejects(() => assertStoredAssetAccess(asset, outsider, { requestId }), error => error.statusCode === 403);
    await assert.rejects(() => assertStoredAssetAccess({ ...asset, segments: ["suppliers", String(new mongoose.Types.ObjectId()), "other.pdf"] }, jefe, { requestId }), error => error.statusCode === 403);
    const accounting = await User.create({ name: "Contabilidad", role: "Accounting", passwordHash: "unused", area: "Finanzas" });
    const changePath = `/accounting/accounts-payable/${partial._id}/credit-terms`;
    assert.equal((await call(jefe, changePath, "PATCH", { creditDays: 30, reason: "No autorizado" })).status, 403);
    assert.equal((await call(accounting, changePath, "PATCH", { creditDays: 1.5, reason: "Inválido" })).status, 422);
    assert.equal((await call(accounting, changePath, "PATCH", { creditDays: 30, reason: "" })).status, 422);
    const changed = await call(accounting, changePath, "PATCH", { creditDays: 30, dueDate: offset(10).toISOString().slice(0, 10), reason: "Vencimiento contractual confirmado" });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.outstandingAmount, 700);
    assert.equal(changed.body.data.paymentTermsSnapshot.creditDays, 30);
    assert.equal(changed.body.data.dueDate.slice(0, 10), offset(10).toISOString().slice(0, 10));
    assert.equal(changed.body.data.plannedPaymentDate.slice(0, 10), offset(3).toISOString().slice(0, 10));
    assert.equal((await Supplier.findById(supplier._id)).paymentTerms.days, 15);
    assert.equal(await AuditLog.countDocuments({ action: "INVOICE_CREDIT_UPDATED" }), 1);
    partial.status = "SCHEDULED";
    await partial.save();
    assert.equal((await call(accounting, changePath, "PATCH", { creditDays: 45, reason: "Bloqueado por instrucción bancaria" })).status, 409);
    await BudgetAllocation.deleteMany({});
    assert.equal((await call(jefe, "/dashboard/summary")).body.jefe.configured, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
