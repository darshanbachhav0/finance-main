import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { getDashboardSummary } from "../src/controllers/dashboardController.js";
import { managementSummary } from "../src/controllers/reportController.js";
import { clearManagementApiCache, managementSnapshot } from "../src/services/externalManagementService.js";
import { listRequestsPage } from "../src/services/requestService.js";
import { OPEN_PAYABLE_STATUSES, isOpenPayable, openPayableAmountPEN } from "../../shared/openPayables.mjs";

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { resolve(body); return this; } };
    handler(req, res, (error) => (error ? reject(error) : resolve(undefined)));
  });
}

test("one open-payables rule: outstanding balance, partial payments at outstanding, bounced still owed", () => {
  assert.deepEqual([...OPEN_PAYABLE_STATUSES], ["OPEN", "SCHEDULED", "PAYMENT_FILE_CREATED", "PARTIALLY_PAID", "PAYMENT_BOUNCED"]);
  assert.equal(openPayableAmountPEN({ status: "PARTIALLY_PAID", originalAmount: 200, outstandingAmount: 50, exchangeRate: 1 }), 50);
  assert.equal(openPayableAmountPEN({ status: "PAYMENT_BOUNCED", outstandingAmount: 10, exchangeRate: 3.75 }), 37.5);
  assert.equal(isOpenPayable({ status: "PAID", outstandingAmount: 0 }), false);
  assert.equal(isOpenPayable({ status: "CANCELLED", outstandingAmount: 100 }), false);
  assert.equal(isOpenPayable({ status: "OPEN", outstandingAmount: 0 }), false);
});

test("dashboard and report numbers", { timeout: 90000 }, async (t) => {
  const database = `erp_operations_numbers_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  clearManagementApiCache();
  try {
    const [solicitorA, solicitorB, management, treasury] = await User.create([
      { name: "Solicitor A", dni: "70000001", passwordHash: "unused", role: "Solicitor", area: "Finance" },
      { name: "Solicitor B", dni: "70000002", passwordHash: "unused", role: "Solicitor", area: "Finance" },
      { name: "Management", dni: "70000003", passwordHash: "unused", role: "Management", area: "Rectorate" },
      { name: "Treasury", dni: "70000004", passwordHash: "unused", role: "Treasury", area: "Treasury" }
    ]);
    const supplierVerified = new mongoose.Types.ObjectId();
    const supplierPending = new mongoose.Types.ObjectId();
    await Supplier.collection.insertMany([
      { _id: supplierVerified, name: "Verified SAC", legalName: "Verified SAC", rucDni: "20111111111" },
      { _id: supplierPending, name: "Pending SAC", legalName: "Pending SAC", rucDni: "20222222222" }
    ]);
    await SupplierBankAccount.collection.insertMany([
      { supplier: supplierVerified, active: true, accountType: "CURRENT", bank: "BBVA", currency: "PEN", verificationStatus: "VERIFIED", ownershipResult: "MATCH", accountNumber: "001" },
      { supplier: supplierPending, active: true, accountType: "CURRENT", bank: "BBVA", currency: "PEN", verificationStatus: "PENDING", ownershipResult: "PENDING", accountNumber: "002" }
    ]);
    const base = { currency: "PEN", exchangeRate: 1, accountingPeriod: "2026-09", issueDate: new Date("2026-09-10T00:00:00Z"), lines: [] };
    const ids = Object.fromEntries(["draftA", "draftB", "pending", "approved", "rejected", "voided", "returned", "awaitingPo", "otherArea", "reimbursement"].map((key) => [key, new mongoose.Types.ObjectId()]));
    await FinancialRequest.collection.insertMany([
      { ...base, _id: ids.draftA, requestNumber: "R-1", requester: solicitorA._id, requesterArea: "Finance", status: "BORRADOR", requestType: "CAPEX", flowType: "A1", totalAmount: 1000, totalPENEquivalent: 1000 },
      { ...base, _id: ids.draftB, requestNumber: "R-2", requester: solicitorB._id, requesterArea: "Finance", status: "BORRADOR", requestType: "OPEX", flowType: "A1", totalAmount: 2000, totalPENEquivalent: 2000 },
      { ...base, _id: ids.pending, requestNumber: "R-3", requester: solicitorB._id, requesterArea: "Finance", status: "PENDIENTE_APROBACION", requestType: "CAPEX", flowType: "A1", totalAmount: 100, totalPENEquivalent: 100 },
      { ...base, _id: ids.approved, requestNumber: "R-4", requester: solicitorB._id, requesterArea: "Finance", status: "CONTABILIZADO", requestType: "OPEX", flowType: "A1", totalAmount: 200, totalPENEquivalent: 200, supplier: supplierVerified },
      { ...base, _id: ids.rejected, requestNumber: "R-5", requester: solicitorB._id, requesterArea: "Finance", status: "RECHAZADO", requestType: "OPEX", flowType: "A1", totalAmount: 50, totalPENEquivalent: 50 },
      { ...base, _id: ids.voided, requestNumber: "R-6", requester: solicitorB._id, requesterArea: "Finance", status: "ANULADO", requestType: "CAPEX", flowType: "A1", totalAmount: 70, totalPENEquivalent: 70 },
      { ...base, _id: ids.returned, requestNumber: "R-7", requester: solicitorA._id, requesterArea: "Finance", status: "DEVUELTO", requestType: "OPEX", flowType: "A1", totalAmount: 10, totalPENEquivalent: 10 },
      { ...base, _id: ids.awaitingPo, requestNumber: "R-8", requester: solicitorB._id, requesterArea: "Finance", status: "COMPROMISO_PRESUPUESTAL", requestType: "OPEX", flowType: "A1", purchaseOrder: null, totalAmount: 20, totalPENEquivalent: 20 },
      { ...base, _id: ids.otherArea, requestNumber: "R-9", requester: solicitorB._id, requesterArea: "Law", status: "CONTABILIZADO", requestType: "OPEX", flowType: "A1", totalAmount: 400, totalPENEquivalent: 400, supplier: supplierPending },
      { ...base, _id: ids.reimbursement, requestNumber: "R-10", requester: solicitorA._id, requesterArea: "Finance", status: "CONTABILIZADO", requestType: "REEMBOLSO_CON_SUSTENTO", flowType: "C", totalAmount: 30, totalPENEquivalent: 30, rendition: { status: "APPROVED", reimbursementBankSnapshot: { profile: new mongoose.Types.ObjectId(), verificationStatus: "VERIFIED" } } }
    ]);
    const past = new Date(Date.now() - 10 * 86400000);
    const ap = (fields) => ({ currency: "PEN", exchangeRate: 1, dueDate: past, createdAt: past, ...fields });
    await AccountsPayable.collection.insertMany([
      ap({ request: ids.approved, supplier: supplierVerified, status: "OPEN", originalAmount: 100, outstandingAmount: 100, penEquivalent: 100 }),
      ap({ request: ids.approved, supplier: supplierVerified, status: "PARTIALLY_PAID", originalAmount: 200, outstandingAmount: 50, penEquivalent: 200 }),
      ap({ request: ids.approved, supplier: supplierVerified, status: "PAYMENT_BOUNCED", originalAmount: 30, outstandingAmount: 30, penEquivalent: 30 }),
      ap({ request: ids.approved, supplier: supplierVerified, status: "PAID", originalAmount: 500, outstandingAmount: 0, penEquivalent: 500 }),
      ap({ request: ids.approved, supplier: supplierVerified, status: "CANCELLED", originalAmount: 900, outstandingAmount: 900, penEquivalent: 900 }),
      ap({ request: ids.otherArea, supplier: supplierPending, status: "OPEN", originalAmount: 400, outstandingAmount: 400, penEquivalent: 400 }),
      ap({ request: ids.otherArea, supplier: supplierPending, status: "SCHEDULED", originalAmount: 10, outstandingAmount: 10, penEquivalent: 10 }),
      ap({ request: ids.reimbursement, status: "OPEN", originalAmount: 30, outstandingAmount: 30, penEquivalent: 30 })
    ]);

    await t.test("general dashboard never shows other people's drafts", async () => {
      const summary = await call(getDashboardSummary, { user: management });
      assert.equal(summary.recentRequests.some((request) => request.status === "BORRADOR"), false);
      assert.equal(summary.byStatus.some((row) => row._id === "BORRADOR"), false);
      const own = await call(getDashboardSummary, { user: solicitorA });
      assert.equal(own.metrics.find((metric) => metric.key === "drafts").value, 1, "a solicitor still sees their own draft");
      assert.equal(own.recentRequests.every((request) => String(request.requester._id || request.requester) === String(solicitorA._id)), true);
    });

    await t.test("management controlled spend excludes drafts, rejected and voided requests", async () => {
      const summary = await call(getDashboardSummary, { user: management });
      const metric = (key) => summary.metrics.find((item) => item.key === key).value;
      assert.equal(metric("capex"), 100);
      assert.equal(metric("opex"), 200 + 10 + 20 + 400);
      assert.equal(metric("spend"), 100 + 200 + 10 + 20 + 400 + 30);
    });

    await t.test("treasury counts only payables without a verified destination as missing bank details", async () => {
      const summary = await call(getDashboardSummary, { user: treasury });
      // The Law supplier's only account is still PENDING verification (an active account is not
      // enough); the reimbursement pays to a verified employee snapshot, not a supplier account.
      assert.equal(summary.metrics.find((metric) => metric.key === "missingBank").value, 2);
    });

    await t.test("portal and Reports report the same pending payments", async () => {
      const portal = (await managementSnapshot("overview", {})).data;
      assert.equal(portal.pendingPayments, 6, "OPEN x3 + SCHEDULED + PARTIALLY_PAID + PAYMENT_BOUNCED");
      assert.equal(portal.pendingPaymentAmountPEN, 100 + 50 + 30 + 400 + 10 + 30);
      const reports = (await call(managementSummary, { query: {}, user: management })).data;
      assert.equal(reports.periodClose.blockers.openPayables, portal.pendingPayments);
      assert.equal(reports.payableAgeing.reduce((sum, row) => sum + row.total, 0), portal.pendingPaymentAmountPEN);
    });

    await t.test("report KPIs follow the chosen filters", async () => {
      const all = (await call(managementSummary, { query: {}, user: management })).data;
      assert.equal(all.overduePayables, 6);
      const finance = (await call(managementSummary, { query: { area: "Finance" }, user: management })).data;
      assert.equal(finance.overduePayables, 4, "the Law payables are outside the area filter");
      assert.equal(finance.periodClose.blockers.openPayables, 4);
    });

    await t.test("request list drill-downs: several statuses and awaiting a Purchase Order", async () => {
      const admin = { _id: new mongoose.Types.ObjectId(), role: "Admin" };
      const returned = await listRequestsPage({ status: "DEVUELTO,OBSERVADO" }, admin);
      assert.deepEqual((returned.data || returned.rows || []).map((row) => row.requestNumber), ["R-7"]);
      const awaiting = await listRequestsPage({ status: "PENDIENTE_OC" }, admin);
      assert.deepEqual((awaiting.data || awaiting.rows || []).map((row) => row.requestNumber), ["R-8"]);
    });
  } finally {
    clearManagementApiCache();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
