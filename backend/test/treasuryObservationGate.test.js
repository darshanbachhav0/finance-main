import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import InvoiceObservation from "../src/models/InvoiceObservation.js";
import MassUploadBatch from "../src/models/MassUploadBatch.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import PurchaseOrder from "../src/models/PurchaseOrder.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { assertNoBlockingObservation, generatePaymentBatch, schedulePayments } from "../src/services/treasuryService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { AP_STATUS, EXPENSE_NATURE, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
const issueDate = "2026-09-10";

test("Treasury rejects a CXP with an unresolved blocking observation and accepts it again once resolved", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_treasury_observation_gate_${process.pid}_${Date.now()}`;
  const cleanupPaths = [];
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), PaymentBatch.init(), InvoiceObservation.init(), SunatVoucher.init()]);
    const center = await CostCenter.create({ code: "CC-TRE-GATE", name: "Treasury Gate", area: "Operations", budgetMode: "ACTIVE", annualBudget: 100000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-TRE-GATE", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const solicitor = await User.create({ name: "Requester", email: "requester-gate@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id });
    const treasury = await User.create({ name: "Treasury Officer", email: "treasury-gate@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" });
    const supplier = await Supplier.create({
      identifierType: "RUC", rucDni: "20999999992", normalizedIdentifier: "20999999992",
      legalName: "Gate Supplier SAC", name: "Gate Supplier SAC", taxpayerStatus: "MANUALLY_VALIDATED",
      complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9792",
      paymentTerms: { option: "CREDIT_30", days: 30 }, active: true, status: "ACTIVE"
    });
    await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000000002", cci: "00219100000000000002", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: treasury._id });
    await AccountingPeriod.create({ period, status: "OPEN", openedBy: treasury._id, history: [{ action: "CREATED", by: treasury._id }] });
    await installBbvaTestConfiguration();
    await AccountingMapping.create({ code: "TRE-GATE-BBVA-BANK", name: "BBVA source", purpose: "BANK", bank: "BBVA", currency: "PEN", accountNumber: "104199", active: true });

    let requestSequence = 0;
    async function makeRequest() {
      requestSequence += 1;
      return FinancialRequest.create({
        requestNumber: `REQ-2026-9${String(requestSequence).padStart(4, "0")}`,
        requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate, accountingPeriod: period, currency: "PEN",
        supplier: supplier._id, solicitor: solicitor._id, requester: solicitor._id,
        description: "Treasury observation gate test", status: REQUEST_STATUS.ACCOUNTED,
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
    }
    async function makePayable(request, { series, number, flowType = FLOW_TYPE.B }) {
      return AccountsPayable.create({
        request: request._id, flowType, supplier: supplier._id,
        supplierIdentifierSnapshot: supplier.rucDni,
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series, number, documentDate: new Date(issueDate) },
        originalAmount: 118, currency: "PEN", exchangeRate: 1, penEquivalent: 118, outstandingAmount: 118,
        dueDate: new Date("2026-10-10"), status: AP_STATUS.OPEN, provisionJournal: new mongoose.Types.ObjectId()
      });
    }

    let cleanRequest, cleanPayable, blockedRequest, blockedPayable, voucher;

    await t.test("setup: a clean payable and a payable with a blocking SUNAT observation", async () => {
      cleanRequest = await makeRequest();
      cleanPayable = await makePayable(cleanRequest, { series: "F001", number: "0101" });

      blockedRequest = await makeRequest();
      blockedPayable = await makePayable(blockedRequest, { series: "F001", number: "0102" });
      voucher = await SunatVoucher.create({
        request: blockedRequest._id, supplier: supplier._id, flowType: FLOW_TYPE.B,
        rucIssuer: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: "0102", seriesNumber: "F001-0102",
        issueDate: new Date(issueDate), currency: "PEN", netAmount: 100, igvAmount: 18, xmlAmount: 118,
        validationStatus: "OBSERVED_SUNAT", observationDetail: "RUC mismatch detected after provisioning.",
        accountsPayable: blockedPayable._id, validatedBy: treasury._id
      });
      blockedPayable.sunatVoucher = voucher._id;
      await blockedPayable.save();
    });

    await t.test("an unresolved observation blocks scheduling", async () => {
      await assert.rejects(
        () => schedulePayments({ payableIds: [String(blockedPayable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req }),
        (error) => error.code === "PAYABLE_BLOCKING_OBSERVATION"
      );
      assert.equal((await AccountsPayable.findById(blockedPayable._id)).status, AP_STATUS.OPEN, "the payable is not silently advanced");
    });

    await t.test("an unresolved observation blocks BBVA batch generation", async () => {
      await assert.rejects(
        () => generatePaymentBatch({ payableIds: [String(blockedPayable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req }),
        (error) => error.code === "PAYABLE_BLOCKING_OBSERVATION"
      );
      assert.equal(await PaymentBatch.countDocuments(), 0, "no bank file is produced for a blocked payable");
    });

    await t.test("resolving the observation makes the payable eligible again automatically", async () => {
      voucher.validationStatus = "VALID";
      voucher.observationDetail = "";
      await voucher.save();
      const scheduled = await schedulePayments({ payableIds: [String(blockedPayable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req });
      assert.equal(scheduled.length, 1);
      assert.equal((await AccountsPayable.findById(blockedPayable._id)).status, AP_STATUS.SCHEDULED);
    });

    await t.test("an OPEN InvoiceObservation (the A2 batch-invoice mechanism) also blocks its linked payable", async () => {
      const a2Request = await makeRequest();
      const a2Payable = await makePayable(a2Request, { series: "F001", number: "0103", flowType: FLOW_TYPE.A2 });
      const purchaseOrder = await PurchaseOrder.create({
        poNumber: `PO-2026-${9000 + requestSequence}`, request: a2Request._id, supplier: supplier._id,
        amount: 118, currency: "PEN", generatedBy: treasury._id
      });
      const batch = await MassUploadBatch.create({
        batchCode: `BATCH-2026-${9000 + requestSequence}`, request: a2Request._id, purchaseOrder: purchaseOrder._id,
        uploadedBy: treasury._id, inputType: "EXCEL",
        inputFile: { originalName: "invoices.xlsx", filename: "invoices.xlsx", path: "/tmp/invoices.xlsx", url: "/test/invoices.xlsx", size: 10, checksum: "test-checksum" }
      });
      await InvoiceObservation.create({
        request: a2Request._id, purchaseOrder: purchaseOrder._id, batch: batch._id, batchItemId: new mongoose.Types.ObjectId(),
        supplier: supplier._id, sourceType: "EXCEL", sourceName: "invoices.xlsx",
        rucIssuer: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: "0103",
        status: "OBSERVED_AMOUNT_EXCEEDED", errorDetail: "Invoice exceeds the remaining PO balance.",
        accountsPayable: a2Payable._id, resolutionStatus: "OPEN"
      });

      await assert.rejects(() => assertNoBlockingObservation(a2Payable), (error) => error.code === "PAYABLE_BLOCKING_OBSERVATION");

      await InvoiceObservation.updateOne({ accountsPayable: a2Payable._id }, { $set: { resolutionStatus: "RESOLVED", resolvedAt: new Date(), resolvedBy: treasury._id } });
      await assert.doesNotReject(() => assertNoBlockingObservation(a2Payable));
    });

    await t.test("an unaffected normal payable still schedules and generates a BBVA batch exactly as before", async () => {
      const result = await generatePaymentBatch({ payableIds: [String(cleanPayable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req });
      cleanupPaths.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      assert.equal(await PaymentBatch.countDocuments(), 1);
      assert.equal((await AccountsPayable.findById(cleanPayable._id)).status, AP_STATUS.PAYMENT_FILE_CREATED);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await Promise.all(cleanupPaths.map((target) => fs.rm(target, { force: true }).catch(() => undefined)));
  }
});
