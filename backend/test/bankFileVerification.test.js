import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { installBbvaTestConfiguration, upcomingPaymentDate } from "./bbvaFixtures.js";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { migrateBankFileVerification } from "../scripts/migrateBankFileVerification.js";
import { listBankFilesForVerification, rejectBankFile, reviewBankFile, verifyBankFile } from "../src/services/bankFileVerificationService.js";
import { downloadStoredFile } from "../src/controllers/fileController.js";
import { assertStoredAssetAccess, resolveStoredAsset } from "../src/services/fileAccessService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { cancelPaymentBatch, confirmTreasuryPayable, generatePaymentBatch, markPaymentBounced } from "../src/services/treasuryService.js";
import { paymentDateWarning } from "../src/utils/bankFileVerification.js";
import { AP_STATUS, EXPENSE_NATURE, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
const issueDate = "2026-09-10";

test("Accounting verifies each bank TXT before Treasury can download it", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_bank_file_verification_${process.pid}_${Date.now()}`;
  const cleanupPaths = [];
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), PaymentBatch.init()]);
    const center = await CostCenter.create({ code: "CC-BFV", name: "Bank file verification", area: "Operations", budgetMode: "ACTIVE", annualBudget: 100000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-BFV", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const solicitor = await User.create({ name: "Requester", email: "requester-bfv@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id });
    const treasury = await User.create({ name: "Treasury Officer", email: "treasury-bfv@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" });
    const accounting = await User.create({ name: "Accounting Officer", email: "accounting-bfv@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Accounting" });
    const admin = await User.create({ name: "Admin", email: "admin-bfv@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" });
    const supplier = await Supplier.create({
      identifierType: "RUC", rucDni: "20999999881", normalizedIdentifier: "20999999881",
      legalName: "Verification Supplier SAC", name: "Verification Supplier SAC", taxpayerStatus: "MANUALLY_VALIDATED",
      complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", supplierCode: "PRV-9881",
      paymentTerms: { option: "CREDIT_30", days: 30 }, active: true, status: "ACTIVE"
    });
    const account = await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000000881", cci: "00219100000000000881", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: treasury._id });
    await AccountingPeriod.create({ period, status: "OPEN", openedBy: treasury._id, history: [{ action: "CREATED", by: treasury._id }] });
    await installBbvaTestConfiguration();
    await AccountingMapping.create({ code: "BFV-BBVA-BANK", name: "BBVA source", purpose: "BANK", bank: "BBVA", currency: "PEN", accountNumber: "104199", active: true });

    let sequence = 0;
    async function makePayable() {
      sequence += 1;
      const request = await FinancialRequest.create({
        requestNumber: `REQ-2026-8${String(sequence).padStart(4, "0")}`,
        requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate, accountingPeriod: period, currency: "PEN",
        supplier: supplier._id, solicitor: solicitor._id, requester: solicitor._id,
        description: "Bank file verification test", status: REQUEST_STATUS.ACCOUNTED,
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      return AccountsPayable.create({
        request: request._id, flowType: FLOW_TYPE.B, supplier: supplier._id, supplierIdentifierSnapshot: supplier.rucDni,
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series: "F001", number: String(800 + sequence), documentDate: new Date(issueDate) },
        originalAmount: 118, currency: "PEN", exchangeRate: 1, penEquivalent: 118, outstandingAmount: 118,
        dueDate: new Date("2026-10-10"), status: AP_STATUS.OPEN, provisionJournal: new mongoose.Types.ObjectId()
      });
    }
    async function makeFile(payables, user = treasury) {
      const result = await generatePaymentBatch({ payableIds: payables.map((ap) => String(ap._id)), bank: "BBVA", currency: "PEN", paymentDate: upcomingPaymentDate(), user, req });
      const filePath = path.join(generatedRoot, "bank-files", result.batch.fileName);
      cleanupPaths.push(filePath);
      return { batch: result.batch, filePath };
    }
    const download = (batch, user) => assertStoredAssetAccess(resolveStoredAsset(batch.url), user);
    const confirm = (ap) => confirmTreasuryPayable({ accountsPayableId: ap._id, payload: { operationNumber: `OP-${ap._id}`, paidAt: issueDate, confirmedAmount: 118 }, user: treasury, req });
    // These fixtures stop at the verification gate; the full confirmation after verification is
    // covered by the lifecycle and treasury payment suites.
    const passesVerificationGate = (ap) => assert.rejects(() => confirm(ap), (error) => error.code !== "BANK_FILE_NOT_VERIFIED");

    await t.test("a new file waits for Accounting: Treasury can neither download it nor settle payments from it", async () => {
      const ap = await makePayable();
      const { batch } = await makeFile([ap]);
      assert.equal(batch.verification.status, "PENDING");
      const task = await Notification.findOne({ user: accounting._id, eventKey: `bank-file:${batch._id}:verification`, resolvedAt: null });
      assert.equal(task?.path, `/accounting/bank-files?record=${batch._id}`);
      await assert.rejects(() => download(batch, treasury), (error) => error.code === "BANK_FILE_NOT_VERIFIED" && error.statusCode === 409);
      // Accounting and Admin open it to review it.
      assert.equal((await download(batch, accounting)).checksum, batch.checksum);
      assert.equal((await download(batch, admin)).checksum, batch.checksum);
      await assert.rejects(() => confirm(ap), (error) => error.code === "BANK_FILE_NOT_VERIFIED");
      await assert.rejects(() => markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "Bank refused", reasonCategory: "TECHNICAL" }, user: treasury, req }), (error) => error.code === "BANK_FILE_NOT_VERIFIED");

      const listed = await listBankFilesForVerification({ verificationStatus: "PENDING" });
      assert.deepEqual(listed.data.map((row) => row.batchNumber), [batch.batchNumber]);
      assert.equal((await listBankFilesForVerification({ verificationStatus: "VERIFIED" })).data.length, 0);
      assert.equal((await reviewBankFile(batch._id)).problems.length, 0);

      await verifyBankFile({ batchId: batch._id, user: accounting, req });
      const stored = await PaymentBatch.findById(batch._id);
      assert.equal(stored.verification.status, "VERIFIED");
      assert.equal(String(stored.verification.verifiedBy), String(accounting._id));
      assert.equal(stored.verification.checksum, batch.checksum);
      assert.ok(await AuditLog.findOne({ entityId: batch._id, action: "BANK_FILE_VERIFIED" }));
      assert.equal(await Notification.countDocuments({ eventKey: `bank-file:${batch._id}:verification`, resolvedAt: null }), 0, "Accounting's task is closed");
      assert.ok(await Notification.findOne({ user: treasury._id, eventKey: `bank-file:${batch._id}:verified` }));
      assert.equal((await download(batch, treasury)).checksum, batch.checksum);
      await passesVerificationGate(ap);
      await assert.rejects(() => verifyBankFile({ batchId: batch._id, user: accounting, req }), (error) => error.statusCode === 409, "a file is verified once");
    });

    await t.test("whoever generated a file does not verify it, except Admin", async () => {
      const { batch } = await makeFile([await makePayable()], accounting);
      await assert.rejects(() => verifyBankFile({ batchId: batch._id, user: accounting, req }), (error) => error.statusCode === 403);
      const own = await makeFile([await makePayable()], admin);
      await verifyBankFile({ batchId: own.batch._id, user: admin, req });
      assert.equal((await PaymentBatch.findById(own.batch._id)).verification.status, "VERIFIED");
      await rejectBankFile({ batchId: batch._id, payload: { reason: "Test cleanup" }, user: admin, req });
    });

    await t.test("a TXT changed after generation, or one still holding a removed payment, fails its checks", async () => {
      const changed = await makeFile([await makePayable()]);
      await fs.appendFile(changed.filePath, "TAMPERED");
      await assert.rejects(() => verifyBankFile({ batchId: changed.batch._id, user: accounting, req }), (error) => error.code === "BANK_FILE_CHECKS_FAILED" && error.details.problems.some((problem) => problem.code === "FILE_CHANGED"));
      assert.equal((await PaymentBatch.findById(changed.batch._id)).verification.status, "PENDING", "a failed check decides nothing");
      // Nobody downloads a changed file, not even Accounting.
      let downloadError;
      await downloadStoredFile({ query: { path: changed.batch.url }, user: accounting }, { setHeader() {}, type() {}, send() { throw new Error("a changed file was sent"); } }, (error) => { downloadError = error; });
      assert.equal(downloadError?.code, "BANK_FILE_INTEGRITY_FAILED");

      const [kept, removed] = [await makePayable(), await makePayable()];
      const partial = await makeFile([kept, removed]);
      await cancelPaymentBatch({ batchId: partial.batch._id, payload: { reason: "Wrong supplier", accountsPayableIds: [String(removed._id)] }, user: treasury, req });
      const { problems } = await reviewBankFile(partial.batch._id);
      assert.deepEqual(problems.map((problem) => problem.code), ["ITEM_REMOVED"]);

      await SupplierBankAccount.updateOne({ _id: account._id }, { $set: { verificationStatus: "OBSERVED" } });
      try {
        assert.ok((await reviewBankFile(partial.batch._id)).problems.some((problem) => problem.code === "DESTINATION_NOT_VERIFIED"));
      } finally {
        await SupplierBankAccount.updateOne({ _id: account._id }, { $set: { verificationStatus: "VERIFIED" } });
      }
      await rejectBankFile({ batchId: changed.batch._id, payload: { reason: "Changed after generation" }, user: accounting, req });
      await rejectBankFile({ batchId: partial.batch._id, payload: { reason: "Holds a removed payment" }, user: accounting, req });
    });

    await t.test("rejecting cancels the file and returns its payments to Treasury's queue with the reason", async () => {
      const ap = await makePayable();
      const { batch } = await makeFile([ap]);
      await assert.rejects(() => rejectBankFile({ batchId: batch._id, payload: { reason: " " }, user: accounting, req }), (error) => error.statusCode === 422);
      await rejectBankFile({ batchId: batch._id, payload: { reason: "Amount does not match the invoice" }, user: accounting, req });
      const stored = await PaymentBatch.findById(batch._id);
      assert.equal(stored.status, "CANCELLED");
      assert.equal(stored.verification.status, "REJECTED");
      assert.equal(stored.verification.reason, "Amount does not match the invoice");
      const payable = await AccountsPayable.findById(ap._id);
      assert.equal(payable.status, AP_STATUS.OPEN);
      assert.equal(payable.paymentBatch, undefined);
      assert.match(payable.history.at(-1).comments, /Rejected by Accounting: Amount does not match the invoice/);
      assert.ok(await Notification.findOne({ user: treasury._id, eventKey: `bank-file:${batch._id}:rejected` }));
      await assert.rejects(() => download(batch, treasury), (error) => error.code === "BANK_FILE_NOT_VERIFIED");
      // A notification link shows the file whatever its status.
      assert.equal((await listBankFilesForVerification({ record: String(batch._id), verificationStatus: "PENDING" })).data[0]?.verificationStatus, "REJECTED");
      // The corrected payment goes into a new file, which waits for Accounting again.
      const next = await makeFile([payable]);
      assert.equal(next.batch.verification.status, "PENDING");
      await verifyBankFile({ batchId: next.batch._id, user: accounting, req });
    });

    await t.test("Treasury cancelling a waiting file closes Accounting's task", async () => {
      const { batch } = await makeFile([await makePayable()]);
      await cancelPaymentBatch({ batchId: batch._id, payload: { reason: "Generated by mistake" }, user: treasury, req });
      assert.equal(await Notification.countDocuments({ eventKey: `bank-file:${batch._id}:verification`, resolvedAt: null }), 0);
      assert.equal((await listBankFilesForVerification({ verificationStatus: "PENDING" })).data.length, 0);
    });

    await t.test("a waiting file whose payment date is reached is only flagged, never blocked", async () => {
      const { batch } = await makeFile([await makePayable()]);
      await PaymentBatch.updateOne({ _id: batch._id }, { $set: { paymentDate: new Date(Date.now() - 3 * 86400000) } });
      const [row] = (await listBankFilesForVerification({ verificationStatus: "PENDING" })).data;
      assert.equal(row.paymentDateWarning, "PASSED");
      const result = await verifyBankFile({ batchId: batch._id, user: accounting, req });
      assert.equal(result.paymentDateWarning, "PASSED");
      assert.equal(paymentDateWarning(await PaymentBatch.findById(batch._id)), null, "a verified file is not flagged");
    });

    await t.test("files generated before this control count as verified; the migration records it", async () => {
      const ap = await makePayable();
      const { batch } = await makeFile([ap]);
      await PaymentBatch.collection.updateOne({ _id: batch._id }, { $unset: { verification: "" } });
      const legacy = await PaymentBatch.findById(batch._id);
      assert.equal((await download(legacy, treasury)).checksum, batch.checksum);
      assert.equal((await listBankFilesForVerification({ verificationStatus: "VERIFIED" })).data.some((row) => row.batchNumber === batch.batchNumber), true);

      const dryRun = await migrateBankFileVerification(mongoose.connection.db);
      assert.deepEqual(dryRun.legacyVerified, [batch.batchNumber]);
      assert.equal((await PaymentBatch.collection.findOne({ _id: batch._id })).verification, undefined, "a dry run changes nothing");
      await migrateBankFileVerification(mongoose.connection.db, { apply: true });
      const migrated = await PaymentBatch.collection.findOne({ _id: batch._id });
      assert.equal(migrated.verification.status, "VERIFIED");
      assert.equal(migrated.verification.legacy, true);
      assert.deepEqual((await migrateBankFileVerification(mongoose.connection.db, { apply: true })).legacyVerified, [], "a rerun finds nothing");
      await passesVerificationGate(ap);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await Promise.all(cleanupPaths.map((target) => fs.rm(target, { force: true }).catch(() => undefined)));
  }
});
