import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import BankFormatConfiguration from "../src/models/BankFormatConfiguration.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import GeneratedFile from "../src/models/GeneratedFile.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { certifyBankFormatConfiguration, generatePaymentBatch } from "../src/services/treasuryService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { AP_STATUS, EXPENSE_NATURE, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
const issueDate = "2026-09-10";

test("BBVA certification is a controlled, per-format/currency action that never retroactively rewrites past files", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_bbva_certification_${process.pid}_${Date.now()}`;
  const cleanupPaths = [];
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), PaymentBatch.init()]);
    const admin = await User.create({ name: "Admin", email: "admin-cert@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" });
    const treasury = await User.create({ name: "Treasury Officer", email: "treasury-cert@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" });
    const penConfig = await installBbvaTestConfiguration("PEN");
    const usdConfig = await installBbvaTestConfiguration("USD");

    await t.test("default configuration is not certified", () => {
      assert.equal(penConfig.certified, false);
      assert.equal(penConfig.certifiedAt, null);
      assert.equal(penConfig.certifiedBy, null);
    });

    await t.test("certifying without a reference/comment is rejected", async () => {
      await assert.rejects(
        () => certifyBankFormatConfiguration({ id: penConfig._id, certified: true, user: admin, req }),
        (error) => error.code === "VALIDATION_ERROR"
      );
    });

    let certifiedPen;
    await t.test("an authorized administrative action certifies the PEN format and is audited", async () => {
      certifiedPen = await certifyBankFormatConfiguration({ id: penConfig._id, certified: true, certificationReference: "Treasury accepted the PEN sample file on 2026-09-15.", user: admin, req });
      assert.equal(certifiedPen.certified, true);
      assert.ok(certifiedPen.certifiedAt);
      assert.equal(String(certifiedPen.certifiedBy), String(admin._id));
      assert.equal(certifiedPen.certificationReference, "Treasury accepted the PEN sample file on 2026-09-15.");
      const audit = await AuditLog.findOne({ entityType: "BankFormatConfiguration", action: "BBVA_FORMAT_CERTIFIED", entityId: penConfig._id });
      assert.ok(audit, "certification produces its own auditable event");
      assert.equal(audit.newValues.certified, true);
    });

    await t.test("PEN and USD certification are independently traceable", async () => {
      const usd = await BankFormatConfiguration.findById(usdConfig._id);
      assert.equal(usd.certified, false, "certifying PEN must not certify USD");
    });

    // --- Fixtures to actually generate a BBVA batch and prove the snapshot behavior ---
    const center = await CostCenter.create({ code: "CC-CERT", name: "Certification", area: "Operations", budgetMode: "ACTIVE", annualBudget: 100000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-CERT", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const solicitor = await User.create({ name: "Requester", email: "requester-cert@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id });
    const supplier = await Supplier.create({
      identifierType: "RUC", rucDni: "20999999993", normalizedIdentifier: "20999999993",
      legalName: "Cert Supplier SAC", name: "Cert Supplier SAC", taxpayerStatus: "MANUALLY_VALIDATED",
      complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9793",
      paymentTerms: { option: "CREDIT_30", days: 30 }, active: true, status: "ACTIVE"
    });
    await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000000003", cci: "00219100000000000003", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: treasury._id });
    await AccountingPeriod.create({ period, status: "OPEN", openedBy: treasury._id, history: [{ action: "CREATED", by: treasury._id }] });
    await AccountingMapping.create({ code: "CERT-BBVA-BANK", name: "BBVA source", purpose: "BANK", bank: "BBVA", currency: "PEN", accountNumber: "104198", active: true });

    async function makeCertifiedFlowRequestAndPayable(number) {
      const request = await FinancialRequest.create({
        requestNumber: number, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate, accountingPeriod: period, currency: "PEN", supplier: supplier._id, solicitor: solicitor._id, requester: solicitor._id,
        description: "BBVA certification snapshot test", status: REQUEST_STATUS.ACCOUNTED,
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      const payable = await AccountsPayable.create({
        request: request._id, flowType: FLOW_TYPE.B, supplier: supplier._id,
        supplierIdentifierSnapshot: supplier.rucDni,
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series: "F002", number: number.slice(-4), documentDate: new Date(issueDate) },
        originalAmount: 118, currency: "PEN", exchangeRate: 1, penEquivalent: 118, outstandingAmount: 118,
        dueDate: new Date("2026-10-10"), status: AP_STATUS.OPEN, provisionJournal: new mongoose.Types.ObjectId()
      });
      return { request, payable };
    }

    let firstBatch, firstGeneratedFile;
    await t.test("a batch generated while certified snapshots certified=true", async () => {
      const { payable } = await makeCertifiedFlowRequestAndPayable("REQ-2026-98001");
      const result = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req });
      cleanupPaths.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      firstBatch = await PaymentBatch.findById(result.batch._id);
      assert.equal(firstBatch.certificationSnapshot.certified, true);
      assert.equal(String(firstBatch.certificationSnapshot.certifiedBy), String(admin._id));
      assert.equal(firstBatch.certificationSnapshot.certificationReference, "Treasury accepted the PEN sample file on 2026-09-15.");
      firstGeneratedFile = await GeneratedFile.findOne({ "metadata.batchId": firstBatch._id });
      assert.equal(firstGeneratedFile.metadata.certificationSnapshot.certified, true);
    });

    await t.test("decertifying afterwards does not rewrite the already-generated batch/file", async () => {
      await certifyBankFormatConfiguration({ id: penConfig._id, certified: false, user: admin, req });
      const stillCertifiedSnapshot = await PaymentBatch.findById(firstBatch._id);
      assert.equal(stillCertifiedSnapshot.certificationSnapshot.certified, true, "a past batch keeps the certification state that applied when it was generated");
      const stillCertifiedFile = await GeneratedFile.findById(firstGeneratedFile._id);
      assert.equal(stillCertifiedFile.metadata.certificationSnapshot.certified, true);
      const liveConfig = await BankFormatConfiguration.findById(penConfig._id);
      assert.equal(liveConfig.certified, false, "the live configuration itself is genuinely decertified");
    });

    await t.test("a new batch generated after decertifying snapshots certified=false", async () => {
      const { payable } = await makeCertifiedFlowRequestAndPayable("REQ-2026-98002");
      const result = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: issueDate, user: treasury, req });
      cleanupPaths.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      const secondBatch = await PaymentBatch.findById(result.batch._id);
      assert.equal(secondBatch.certificationSnapshot.certified, false);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await Promise.all(cleanupPaths.map((target) => fs.rm(target, { force: true }).catch(() => undefined)));
  }
});
