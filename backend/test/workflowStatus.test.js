import { preflightDirectPayment, provisionDirectPayment } from "../src/services/directPaymentService.js";
import { fiscalFixture, invoiceXml, invoiceZip } from "./fiscalFixtures.js";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";
import { reserveBudget, deferBudget } from "../src/services/budgetService.js";
import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { migrateWorkflowStatuses } from "../scripts/migrateWorkflowStatusesV2.js";
import PurchaseOrder from "../src/models/PurchaseOrder.js";
import MassUploadBatch from "../src/models/MassUploadBatch.js";
import { registerA1Invoice } from "../src/services/invoiceRegistrationService.js";
import { createMassUploadBatch, processMassUploadBatch, retryInvoiceObservation } from "../src/services/batchInvoiceService.js";
import { taskBlueprints } from "../src/services/workflowTaskPolicy.js";
import Notification from "../src/models/Notification.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountingMapping from "../src/models/AccountingMapping.js";
import Reconciliation from "../src/models/Reconciliation.js";
import JournalEntry from "../src/models/JournalEntry.js";
import AuditLog from "../src/models/AuditLog.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import User from "../src/models/User.js";
import { canModifyRequest } from "../src/utils/permissions.js";
import { allowedTransitions, transitionRequest } from "../src/services/workflowService.js";
import { getFinancialProgress, syncFinancialProgress } from "../src/services/financialProgressService.js";
import { createAccountsPayableFromVoucher } from "../src/services/accountingService.js";
import { generatePaymentBatch, confirmTreasuryPayable, reconcilePayment, listReconciliationQueue } from "../src/services/treasuryService.js";
import { updateFinancialRequest, submitFinancialRequest, deleteFinancialRequest, voidFinancialRequest, closeFinancialRequest, listRequestsPage } from "../src/services/requestService.js";
import { deriveFinancialProgress, canonicalRequestStatus } from "../../shared/workflowStatus.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { generatedRoot, tempUploadDir, uploadRoot } from "../src/services/storageService.js";

test("canonical status compatibility and partial child evidence", () => {
  assert.equal(canonicalRequestStatus("PAGADO_CERRADO"), "CERRADO");
  assert.deepEqual(taskBlueprints("FinancialRequest", { status: "RECHAZADO" }), []);
  assert.ok(taskBlueprints("FinancialRequest", { _id: "C", flowType: "C", status: "PAGADO", rendition: { status: "PENDING" }, requester: "owner" }).some(task => task.stage === "rendition-submit"));
  for (const status of ["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"]) assert.deepEqual(allowedTransitions(status), []);
  const req = { status: "TXT_GENERADO", payment: { confirmations: [{ accountsPayable: "1", amount: 118, paidAt: new Date(), confirmedAt: new Date(), operationNumber: "OP1" }] } };
  const children = [1, 2, 3].map(n => ({ _id: String(n), originalAmount: 118, outstandingAmount: n === 1 ? 0 : 118, provisionJournal: "J1", paymentJournal: n === 1 ? "J2" : null, paidDate: n === 1 ? new Date() : null, status: n === 1 ? "PAID" : "PAYMENT_FILE_CREATED", paymentBatch: { checksum: "abc", generatedAt: new Date(), items: [{ accountsPayable: String(n), status: "INSTRUCTION_CREATED" }] } }));
  const result = deriveFinancialProgress(req, children);
  assert.equal(result.status, "TXT_GENERADO");
  assert.equal(result.counts.paid, 1);
  assert.equal(result.partialPayment, true);
  assert.deepEqual(result.amounts, { total: 354, paid: 118, reconciled: 0 });
  assert.equal(deriveFinancialProgress({ payment: {} }, [{ ...children[0], status: "PAID" }]).status, "TXT_GENERADO");
});

test("workflow status actions preserve financial evidence", { timeout: 120000 }, async t => {
  const database = "erp_workflow_status_" + process.pid + "_" + Date.now();
  await mongoose.connect("mongodb://127.0.0.1:27017/" + database);
    const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), Reconciliation.init(), JournalEntry.init()]);
    await installBbvaTestConfiguration();
    await AccountingMapping.create({code:"STATUS-BBVA-BANK",name:"BBVA source",purpose:"BANK",bank:"BBVA",currency:"PEN",accountNumber:"104102",active:true});
    const owner = await User.create({ name: "Workflow owner", email: "status.owner@test.local", passwordHash: "unused", role: "Solicitor", area: "Operations" });
    const admin = await User.create({ name: "Workflow admin", email: "status.admin@test.local", passwordHash: "unused", role: "Admin", area: "Finance" });
    const treasury = await User.create({ name: "Workflow treasury", email: "status.treasury@test.local", passwordHash: "unused", role: "Treasury", area: "Finance" });
    const center = await CostCenter.create({ code: "STATUS-CC", name: "Status tests", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expense = await ExpenseType.create({ code: "STATUS-EXP", name: "Status expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999991", normalizedIdentifier: "20999999991", legalName: "Status Supplier", name: "Status Supplier", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: "PEN", accountType: "CURRENT", accountNumber: "191000000001", cci: "00219100000000000001", active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: admin._id });
    await AccountingPeriod.create({ period: "2026-08", status: "OPEN" });
    await AccountingPeriod.create({ period: "2026-07", status: "CLOSED", policy: { blockPosting: false, blockUpdate: false } });
    for (const [purpose, accountNumber] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101"], ["ADVANCE_TRANSIT", "141301"]]) await AccountingMapping.create({ code: "STATUS-" + purpose, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: purpose === "BANK" ? "BCP" : "*", currency: "*", accountNumber, active: true });
    const req = { headers: {}, ip: "127.0.0.1" };
    let sequence = 0;
    const makeRequest = overrides => FinancialRequest.create({ issueDate: "2026-08-10", accountingPeriod: "2026-08", flowType: "A1", requestType: "OPEX", expenseNature: "MAINTENANCE", supplier: supplier._id, solicitor: owner._id, requester: owner._id, requesterArea: "Operations", currency: "PEN", description: "Workflow regression", status: "COMPROMISO_PRESUPUESTAL", approvalStage: "COMPLETE", approvalRouteSnapshot: [{ approvalLevel: "AREA_DIRECTOR", role: "Approver", sequence: 1, required: true, status: "APPROVED" }], lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }], ...overrides });
    async function payable(request, flowType = request.flowType) {
      await reserveBudget(request, admin._id);
      const voucher = { ruc: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: String(++sequence), issueDate: "2026-08-10", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 };
      const evidence = request.flowType === "C" ? null : await fiscalFixture(request, supplier, voucher, admin, files);
      const ap = await createAccountsPayableFromVoucher({ request, supplier, voucher, sunatVoucher: evidence?.stored, flowType, user: admin });
      await syncFinancialProgress({ request, user: admin, req });
      return ap;
    }
    async function batch(payables) {
      const result = await generatePaymentBatch({ payableIds: payables.map(ap => String(ap._id)), bank: "BBVA", currency: "PEN", paymentDate: "2026-08-15", user: treasury, req });
      files.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      return result;
    }
    const confirm = ap => confirmTreasuryPayable({ accountsPayableId: ap._id, payload: { operationNumber: "BANK-" + ap._id, paidAt: "2026-08-15", confirmedAmount: 118 }, user: treasury, req });
    const reconcile = ap => reconcilePayment({ accountsPayableId: ap._id, payload: { bankReference: "STATEMENT-" + ap._id, statementAmount: 118 }, user: treasury, req });

    await t.test("migration replaces only the obsolete per-request reconciliation unique index", async () => {
      await Reconciliation.collection.dropIndex("request_1").catch(() => {});
      await Reconciliation.collection.createIndex({ request: 1 }, { unique: true });
      assert.ok((await migrateWorkflowStatuses(mongoose.connection.db)).indexesToDrop.includes("request_1"));
      await migrateWorkflowStatuses(mongoose.connection.db, { apply: true });
      const indexes = await Reconciliation.collection.indexes();
      assert.equal(indexes.find(index => index.name === "request_1").unique, undefined);
      assert.equal(indexes.find(index => index.name === "reconciliation_payable_unique").unique, true);
    });
    await t.test("rejected, cancelled and historical closed requests cannot change or lose evidence", async () => {
      for (const status of ["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"]) {
        const request = await makeRequest({ status: "BORRADOR" });
        await FinancialRequest.collection.updateOne({ _id: request._id }, { $set: { status } });
        const loaded = await FinancialRequest.findById(request._id);
        assert.equal(canModifyRequest(loaded, owner), false);
        assert.equal(canModifyRequest(loaded, admin), false);
        await assert.rejects(() => updateFinancialRequest({ id: loaded._id, payload: { description: "changed" }, files: {}, user: admin, req }));
        await assert.rejects(() => submitFinancialRequest({ id: loaded._id, user: admin, req }));
        await assert.rejects(() => deleteFinancialRequest({ id: loaded._id, user: admin, req }));
        await assert.rejects(() => transitionRequest({ request: loaded, targetStatus: "EN_VALIDACION", skipControls: true, user: admin, req }));
        assert.equal((await FinancialRequest.collection.findOne({ _id: loaded._id })).status, status);
        assert.equal(loaded.toJSON().status, canonicalRequestStatus(status));
      }
      assert.equal(await FinancialRequest.countDocuments({ status: "CERRADO" }), 2);
      const legacyAccounted = await makeRequest({ status: "BORRADOR" });
      await FinancialRequest.collection.updateOne({ _id: legacyAccounted._id }, { $set: { status: "PROVISIONADO_CXP" } });
      assert.equal(await FinancialRequest.countDocuments({ status: "CONTABILIZADO" }), 1);
      assert.equal((await FinancialRequest.findById(legacyAccounted._id)).toJSON().status, "CONTABILIZADO");
      const grouped = await FinancialRequest.aggregate([{ $match: { status: "CERRADO" } }, { $count: "total" }]);
      assert.equal(grouped[0].total, 2);
    });
    await t.test("ordinary cancellation is terminal and refuses posted obligations", async () => {
      const draft = await makeRequest({ status: "BORRADOR" });
      const cancelled = await voidFinancialRequest({ id: draft._id, user: admin, req, comments: "No longer required" });
      assert.equal(cancelled.status, "ANULADO");
      await assert.rejects(() => voidFinancialRequest({ id: draft._id, user: admin, req, comments: "again" }));
      const posted = await makeRequest();
      await payable(posted);
      await assert.rejects(() => voidFinancialRequest({ id: posted._id, user: admin, req, comments: "No" }), /financial obligations/);
    });
    await t.test("three invoices stay TXT after one payment and PAGADO until every reconciliation", async () => {
      const request = await makeRequest({ lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 300, igvAmount: 54, totalAmount: 354 }] });
      const children = [];
      for (let n = 0; n < 3; n++) children.push(await payable(request, n === 2 ? "A2" : "A1"));
      await batch(children);
      assert.equal((await FinancialRequest.findById(request._id)).status, "TXT_GENERADO");
      await assert.rejects(() => closeFinancialRequest({ id: request._id, user: admin, req }));
      await confirm(children[0]);
      assert.equal(await Notification.countDocuments({ user: treasury._id, type: "PAYMENT_CONFIRMATION", resolvedAt: null }), 2);
      let loaded = await FinancialRequest.findById(request._id);
      assert.equal(loaded.status, "TXT_GENERADO");
      assert.equal((await getFinancialProgress(loaded)).counts.paid, 1);
      const list = await listRequestsPage({ search: loaded.requestNumber }, admin);
      assert.equal(list.data[0].financialProgress.counts.paid, 1);
      const queue = await listReconciliationQueue({});
      assert.ok(queue.data.some(row => String(row.payableId) === String(children[0]._id)));
      await reconcile(children[0]);
      assert.equal((await FinancialRequest.findById(request._id)).status, "TXT_GENERADO");
      await assert.rejects(() => reconcile(children[0]));
      await confirm(children[1]); await confirm(children[2]);
      assert.equal((await FinancialRequest.findById(request._id)).status, "PAGADO");
      await reconcile(children[1]);
      assert.equal((await FinancialRequest.findById(request._id)).status, "PAGADO");
      await reconcile(children[2]);
      loaded = await FinancialRequest.findById(request._id);
      assert.equal(loaded.status, "CONCILIADO");
      assert.equal((await getFinancialProgress(loaded)).counts.reconciled, 3);
      const evidenceBefore = await Reconciliation.countDocuments({ request: request._id });
      const closed = await closeFinancialRequest({ id: request._id, user: admin, req });
      assert.equal(closed.status, "CERRADO");
      assert.equal(await Reconciliation.countDocuments({ request: request._id }), evidenceBefore);
      assert.ok(await AuditLog.exists({ requestId: request._id, action: "CLOSED" }));
    });
    await t.test("Track C payment remains PAGADO while rendition is pending", async () => {
      const request = await makeRequest({ flowType: "C", requestType: "ENTREGA_RENDIR" });
      const ap = await payable(request);
      // Seed a generated instruction for the already tested common confirmation path.
      ap.status = "PAYMENT_FILE_CREATED"; ap.bankAccountSnapshot = { bank: "BCP" }; await ap.save();
      request.status = "TXT_GENERADO"; await request.save();
      await confirm(ap);
      let loaded = await FinancialRequest.findById(request._id);
      assert.equal(loaded.status, "PAGADO");
      assert.equal(loaded.rendition.status, "PENDING");
      assert.equal((await getFinancialProgress(loaded)).renditionStatus, "RENDICION_PENDIENTE");
      await FinancialRequest.collection.updateOne({ _id: request._id }, { $set: { status: "OBSERVADO_PRESUPUESTO", observation: { code: "INSUFFICIENT_BUDGET", detail: "Legacy rendition observation" } } });
      await migrateWorkflowStatuses(mongoose.connection.db, { apply: true });
      loaded = await FinancialRequest.findById(request._id);
      assert.equal(loaded.status, "PAGADO");
      assert.equal(loaded.observation.code, "INSUFFICIENT_BUDGET");
      loaded.observation = undefined; await loaded.save();
      await reconcile(ap);
      loaded = await FinancialRequest.findById(request._id);
      assert.equal(loaded.status, "CONCILIADO");
      await assert.rejects(() => closeFinancialRequest({ id: request._id, user: admin, req }), /rendered/);
      loaded.rendition.status = "VALIDATED"; loaded.rendition.balanceOutstanding = 0; await loaded.save();
      assert.equal((await closeFinancialRequest({ id: request._id, user: admin, req })).status, "CERRADO");
    });
    await t.test("migration dry-run preserves evidence; apply is additive and idempotent", async () => {
      const request = await makeRequest({ status: "BORRADOR" });
      await FinancialRequest.collection.updateOne({ _id: request._id }, { $set: { status: "PAGADO_CERRADO" }, $unset: { workflowVersion: "" } });
      const before = await FinancialRequest.collection.findOne({ _id: request._id });
      const auditCount = await AuditLog.countDocuments();
      const journalCount = await JournalEntry.countDocuments();
      const reconciliationCount = await Reconciliation.countDocuments();
      const dry = await migrateWorkflowStatuses(mongoose.connection.db);
      assert.ok(dry.changes.some(change => change.request === String(request._id) && change.to === "CERRADO"));
      assert.deepEqual(await FinancialRequest.collection.findOne({ _id: request._id }), before);
      await migrateWorkflowStatuses(mongoose.connection.db, { apply: true });
      const after = await FinancialRequest.collection.findOne({ _id: request._id });
      assert.equal(after.status, "CERRADO"); assert.equal(after.legacyWorkflowStatus, "PAGADO_CERRADO");
      assert.deepEqual(after.approvalHistory, before.approvalHistory);
      assert.equal(await AuditLog.countDocuments(), auditCount);
      assert.equal(await JournalEntry.countDocuments(), journalCount);
      assert.equal(await Reconciliation.countDocuments(), reconciliationCount);
      assert.equal((await migrateWorkflowStatuses(mongoose.connection.db, { apply: true })).changes.length, 0);
    });
    await t.test("Track B rechecks XML values and provisions only a verified individual invoice", async () => {
      const request = await makeRequest({ flowType: "B" });
      const voucher = { ruc: supplier.rucDni, series: "FB01", number: "001", issueDate: "2026-08-10", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 };
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `direct-${request._id}.xml`); files.push(filePath);
      await fs.writeFile(filePath, invoiceXml(voucher));
      request.attachments = [{ kind: "XML", filename: "direct.xml", originalName: "direct.xml", path: filePath, url: "/test/direct.xml", mimetype: "application/xml", size: 500 }];
      request.xmlValidation = { validated: true, status: "VALID", data: { ...voucher, invoiceNumber: "FB01-001" } };
      await request.save();
      const originalTotal = request.totalAmount; request.totalAmount = 119;
      await assert.rejects(() => preflightDirectPayment({ request, user: admin, req }), error => error.code === "XML_AMOUNT_MISMATCH");
      request.totalAmount = originalTotal;
      await reserveBudget(request, admin._id);
      const checked = await preflightDirectPayment({ request, user: admin, req }); assert.equal(checked.valid, true);
      const result = await provisionDirectPayment({ request, user: admin, req, preflight: checked });
      assert.equal(result.accountsPayable.originalAmount, 118);
      assert.equal(result.request?.status || request.status, "CONTABILIZADO");
      assert.equal(result.accountsPayable.exchangeRateEvidence.source, "PEN");
    });

    await t.test("A1 first/additional and A2 worker validate actual invoice files before posting", async () => {
      const request = await makeRequest({ lines: [{ costCenter: center._id, expenseType: expense._id, netAmount: 400, igvAmount: 72, totalAmount: 472 }], attachments: [{ kind: "CONFORMITY", originalName: "conformity.pdf", filename: "conformity.pdf", url: "/test/conformity.pdf", mimetype: "application/pdf", size: 12 }] });
      await reserveBudget(request, admin._id);
      const order = await PurchaseOrder.create({ poNumber: "FISCAL-PO", request: request._id, supplier: supplier._id, amount: 472, currency: "PEN", generatedBy: admin._id });
      const directory = path.resolve(uploadRoot, "requests", String(request._id));
      const voucher = number => ({ ruc: supplier.rucDni, voucherType: "FACTURA", series: "F088", number, issueDate: "2026-08-10", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 });
      async function upload(name, content, mimetype) {
        await fs.mkdir(tempUploadDir, { recursive: true });
        const filename = `${request._id}-${name}`, filePath = path.join(tempUploadDir, filename);
        await fs.writeFile(filePath, content);
        return { path: filePath, filename, originalname: name, mimetype, size: Buffer.byteLength(content) };
      }
      try {
        for (const number of ["001", "002"]) {
          const result = await registerA1Invoice({ requestId: request._id, user: admin, req, files: { xml: [await upload(`invoice-${number}.xml`, invoiceXml(voucher(number)), "application/xml")], pdf: [await upload(`invoice-${number}.pdf`, "%PDF-1.4 test", "application/pdf")] } });
          assert.equal(result.observed, false);
        }
        const content = invoiceZip({ "invoice-003.xml": invoiceXml(voucher("003")), "invoice-003.pdf": "%PDF-1.4 test", "wrong.xml": invoiceXml({ ...voucher("004"), ruc: "20111111111" }), "wrong.pdf": "%PDF-1.4 test" });
        const file = await upload("batch.zip", content, "application/zip"); files.push(file.path);
        const batch = await MassUploadBatch.create({ batchCode: "FISCAL-BATCH", request: request._id, purchaseOrder: order._id, uploadedBy: admin._id, inputType: "ZIP", inputFile: { ...file, originalName: file.originalname }, status: "QUEUED" });
        await processMassUploadBatch(batch._id);
        const saved = await MassUploadBatch.findById(batch._id);
        assert.equal(saved.processedSuccess, 1, JSON.stringify(saved.items));
        assert.equal(saved.observed, 1);
        assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 3);
        assert.equal((await PurchaseOrder.findById(order._id)).remainingAmount, 118);
        assert.equal((await mongoose.model("BudgetCommitment").findOne({ request: request._id })).executedAmount, 354);
        const observation = await mongoose.model("InvoiceObservation").findOne({ batch: batch._id, resolutionStatus: "OPEN" });
        const correction = await upload("corrected.xml", invoiceXml(voucher("004")), "application/xml");
        await assert.rejects(() => retryInvoiceObservation({ observationId: observation._id, user: admin, req, files: { xml: [correction] } }), error => error.code === "XML_AMOUNT_MISMATCH");
        assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 3);
        await retryInvoiceObservation({ observationId: observation._id, user: admin, req, acceptXmlValues: true });
        assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 4);
        assert.ok(await AuditLog.exists({ requestId: request._id, action: "XML_VALUES_CORRECTED" }));
      } finally {
        assert.equal(path.dirname(directory), path.resolve(uploadRoot, "requests"));
        assert.match(path.basename(directory), /^[a-f0-9]{24}$/);
        await fs.rm(directory, { recursive: true, force: true });
      }
    });

    await t.test("closed periods stop A1 entry and queued A2 workers before processing evidence", async () => {
      const request = await makeRequest({ accountingPeriod: "2026-07" });
      await assert.rejects(() => registerA1Invoice({ requestId: request._id, files: {}, user: admin, req }), error => error.code === "ACCOUNTING_PERIOD_CLOSED");
      const inserted = await PurchaseOrder.collection.insertOne({ request: request._id, status: "ISSUED", remainingAmount: 118, amount: 118 });
      await assert.rejects(() => createMassUploadBatch({ purchaseOrderId: inserted.insertedId, files: { batchFile: [{ originalname: "closed.zip" }] }, user: admin, req }), error => error.code === "ACCOUNTING_PERIOD_CLOSED");
      const batch = await MassUploadBatch.create({ batchCode: "CLOSED-PERIOD", request: request._id, purchaseOrder: inserted.insertedId, uploadedBy: admin._id, inputType: "ZIP", inputFile: { originalName: "closed.zip", filename: "closed.zip", path: "must-not-read.zip", url: "/unused", size: 1 }, status: "QUEUED" });
      await assert.rejects(() => processMassUploadBatch(batch._id), error => error.code === "ACCOUNTING_PERIOD_CLOSED");
      assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 0);
      assert.equal(await JournalEntry.countDocuments({ request: request._id }), 0);
      assert.equal((await PurchaseOrder.findById(inserted.insertedId)).remainingAmount, 118);
    });
    await t.test("A1, additional invoices and A2 posting cannot bypass a closed period", async () => {
      for (const flowType of ["A1", "A2", "B", "C"]) {
        const request = await makeRequest();
        const before = await AccountsPayable.countDocuments({ request: request._id });
        request.accountingPeriod = "2026-07"; await request.save();
        await assert.rejects(() => payable(request, flowType), error => error.code === "ACCOUNTING_PERIOD_CLOSED");
        assert.equal(await AccountsPayable.countDocuments({ request: request._id }), before);
        assert.equal(await JournalEntry.countDocuments({ request: request._id }), 0);
        await assert.rejects(() => transitionRequest({ request, targetStatus: "CONTABILIZADO", skipControls: true, user: admin, req }));
      }
      const request = await makeRequest();
      await payable(request);
      request.accountingPeriod = "2026-07"; await request.save();
      await assert.rejects(() => payable(request), error => error.code === "ACCOUNTING_PERIOD_CLOSED");
      assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 1);
    });
  } finally {
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    for (const file of files) await fs.rm(file, { force: true });
  }
});
