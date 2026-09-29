import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import ExchangeRate from "../src/models/ExchangeRate.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import InvoiceObservation from "../src/models/InvoiceObservation.js";
import JournalEntry from "../src/models/JournalEntry.js";
import MassUploadBatch from "../src/models/MassUploadBatch.js";
import PurchaseOrder from "../src/models/PurchaseOrder.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import Supplier from "../src/models/Supplier.js";
import SupplierCredit from "../src/models/SupplierCredit.js";
import User from "../src/models/User.js";
import {
  assertPostingAccount,
  cancelAccountsPayable,
  createAccountsPayableFromVoucher,
  getConsolidation,
  igvIsRecoverable,
  processAccountsPayable
} from "../src/services/accountingService.js";
import { applySupplierCredit, recoverSupplierCredit, registerAdjustmentNote } from "../src/services/adjustmentNoteService.js";
import { createMassUploadBatch, processMassUploadBatch } from "../src/services/batchInvoiceService.js";
import { reserveBudget } from "../src/services/budgetService.js";
import { syncFinancialProgress } from "../src/services/financialProgressService.js";
import { approveManualSunatException, registerA1Invoice } from "../src/services/invoiceRegistrationService.js";
import { closeAccountingPeriod } from "../src/services/periodAdministrationService.js";
import { periodFromDate } from "../src/services/periodService.js";
import { consumePurchaseOrderBalance } from "../src/services/purchaseOrderMatchingService.js";
import { findDuplicateVoucher, voucherIdentity } from "../src/services/sunatVoucherService.js";
import { tempUploadDir, uploadRoot } from "../src/services/storageService.js";
import { assertNoBlockingObservation } from "../src/services/treasuryService.js";
import { canonicalSeriesNumber, canonicalVoucherType, sunatDocumentTypeCode } from "../src/utils/voucherIdentity.js";
import { fiscalFixture, invoiceXml, invoiceZip } from "./fiscalFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

function noteXml({ kind = "CreditNote", id, issueDate, ruc, currency = "PEN", netAmount, igvAmount, totalAmount, reference }) {
  const referenceBlock = reference ? `<BillingReference><InvoiceDocumentReference><ID>${reference}</ID><DocumentTypeCode>01</DocumentTypeCode></InvoiceDocumentReference></BillingReference>` : "";
  const totals = kind === "DebitNote" ? "RequestedMonetaryTotal" : "LegalMonetaryTotal";
  return `<${kind}><ID>${id}</ID><IssueDate>${issueDate}</IssueDate><DocumentCurrencyCode>${currency}</DocumentCurrencyCode>${referenceBlock}<AccountingSupplierParty><CompanyID>${ruc}</CompanyID></AccountingSupplierParty><TaxTotal><TaxAmount>${igvAmount}</TaxAmount></TaxTotal><${totals}><LineExtensionAmount>${netAmount}</LineExtensionAmount><PayableAmount>${totalAmount}</PayableAmount></${totals}></${kind}>`;
}

function xlsxWorkbook(rows) {
  const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const letters = ["A", "B", "C"];
  const sheetRows = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => cell(`${letters[column]}${index + 1}`, value)).join("")}</row>`).join("");
  return invoiceZip({
    "[Content_Types].xml": "<Types></Types>",
    "xl/workbook.xml": "<workbook><sheets><sheet name=\"Sheet1\"/></sheets></workbook>",
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`
  });
}

test("accounting fixes: SUNAT exception, periods, FX, notes, IGV, cancellation, duplicates, batches", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_accounting_fixes_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const files = [];
  const originalMode = process.env.SUNAT_PROVIDER_MODE;
  const originalPadronDir = process.env.SUNAT_PADRON_DATA_DIR;
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), SunatVoucher.init(), SupplierCredit.init(), AuditLog.init()]);
    const currentPeriod = periodFromDate(new Date());
    for (const period of new Set(["2026-04", "2026-05", "2026-07", "2026-08", currentPeriod])) await AccountingPeriod.create({ period, status: "OPEN" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["SUPPLIER_CREDIT", "168101"], ["BANK", "104101", "BCP"]]) {
      await AccountingMapping.create({ code: `FIX-${purpose}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    const admin = await User.create({ name: "Fix admin", email: "fix.admin@test.local", passwordHash: "unused", role: "Admin", area: "Finance" });
    const accounting = await User.create({ name: "Fix accounting", email: "fix.accounting@test.local", passwordHash: "unused", role: "Accounting", area: "Finance" });
    const owner = await User.create({ name: "Fix owner", email: "fix.owner@test.local", passwordHash: "unused", role: "Solicitor", area: "Operations" });
    const center = await CostCenter.create({ code: "FIX-CC", name: "Fixes", area: "Operations", budgetMode: "ACTIVE", annualBudget: 10000000, active: true });
    const opex = await ExpenseType.create({ code: "FIX-OPEX", name: "Service", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const nonIgv = await ExpenseType.create({ code: "FIX-NOIGV", name: "IGV not creditable", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "659101", igvDeductible: false, active: true });
    const capex = await ExpenseType.create({ code: "FIX-CAPEX", name: "Equipment", category: "CAPEX", accountingClass: "CLASS_3", accountNumber: "336101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20555555551", normalizedIdentifier: "20555555551", legalName: "Fix Supplier", name: "Fix Supplier", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, paymentTerms: { option: "CREDIT_30", days: 30 } });
    let sequence = 0;
    const makeRequest = (overrides = {}) => FinancialRequest.create({
      issueDate: "2026-08-10", accountingPeriod: "2026-08", flowType: "A1", requestType: "OPEX", expenseNature: "MAINTENANCE", supplier: supplier._id,
      solicitor: owner._id, requester: owner._id, requesterArea: "Operations", currency: "PEN", description: "Accounting fixes", status: "COMPROMISO_PRESUPUESTAL",
      approvalStage: "COMPLETE", approvalRouteSnapshot: [{ approvalLevel: "AREA_DIRECTOR", role: "AreaDirector", sequence: 1, required: true, status: "APPROVED" }],
      attachments: [{ kind: "CONFORMITY", originalName: "conformity.pdf", filename: "conformity.pdf", url: "/test/conformity.pdf", mimetype: "application/pdf", size: 12 }],
      lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 1000, igvAmount: 180, totalAmount: 1180 }], ...overrides
    });
    const invoice = (overrides = {}) => ({ ruc: supplier.rucDni, voucherType: "FACTURA", series: "F001", number: String(++sequence).padStart(8, "0"), issueDate: "2026-08-10", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118, ...overrides });
    async function payable(request, voucher, extra = {}) {
      const evidence = await fiscalFixture(request, supplier, voucher, admin, files);
      const ap = await createAccountsPayableFromVoucher({ request, supplier, voucher, sunatVoucher: evidence.stored, flowType: request.flowType, user: admin, ...extra });
      await request.save();
      return { ap, evidence };
    }
    async function writeTemp(name, content) {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
      await fs.writeFile(filePath, content);
      files.push(filePath);
      return { path: filePath, filename: path.basename(filePath), originalname: name, mimetype: name.endsWith(".xml") ? "application/xml" : "application/pdf", size: Buffer.byteLength(content) };
    }

    await t.test("8. voucher identity is canonical: leading zeros and SUNAT Tabla 10 codes", async () => {
      assert.equal(canonicalSeriesNumber("F001-00001234"), "F001-1234");
      assert.equal(canonicalVoucherType("01"), "FACTURA");
      assert.equal(canonicalVoucherType("07"), "NOTA_CREDITO");
      assert.equal(sunatDocumentTypeCode("BOLETA"), "03");
      assert.deepEqual(voucherIdentity({ ruc: "20555555551", voucherType: "01", invoiceNumber: "f001-00001234" }), voucherIdentity({ ruc: "20555555551", voucherType: "FACTURA", series: "F001", number: "1234" }));
      const request = await makeRequest();
      await reserveBudget(request, admin._id);
      const { ap } = await payable(request, invoice({ number: "00001234" }));
      assert.equal(ap.voucher.number, "1234");
      assert.ok(await findDuplicateVoucher({ ruc: supplier.rucDni, voucherType: "01", series: "F001", number: "1234" }));
      // A legacy row stored padded is still found by the unpadded number.
      await SunatVoucher.collection.insertOne({ request: request._id, flowType: "A1", supplier: supplier._id, rucIssuer: supplier.rucDni, voucherType: "FACTURA", series: "F009", number: "00000077", seriesNumber: "F009-00000077", xmlAmount: 1, validationStatus: "VALID" });
      assert.ok(await findDuplicateVoucher({ ruc: supplier.rucDni, voucherType: "01", invoiceNumber: "F009-77" }));
      const other = await makeRequest();
      await reserveBudget(other, admin._id);
      await assert.rejects(() => createAccountsPayableFromVoucher({ request: other, supplier, voucher: invoice({ number: "1234", voucherType: "01" }), flowType: "A1", user: admin }), error => error.code === "DUPLICATE_VOUCHER");
    });

    await t.test("1. PADRON mode: never-downloaded message, one Accounting user approves the exception, CXP posts and is payable", async () => {
      const padronDir = await fs.mkdtemp(path.join(os.tmpdir(), "uma-padron-empty-"));
      process.env.SUNAT_PROVIDER_MODE = "PADRON";
      process.env.SUNAT_PADRON_DATA_DIR = padronDir;
      try {
        const request = await makeRequest();
        await reserveBudget(request, admin._id);
        await PurchaseOrder.create({ poNumber: "FIX-PO-1", request: request._id, supplier: supplier._id, amount: 1180, currency: "PEN", generatedBy: admin._id });
        const voucher = invoice();
        const xml = await writeTemp("invoice.xml", invoiceXml(voucher));
        const pdf = await writeTemp("invoice.pdf", "%PDF-1.4 test");
        const observed = await registerA1Invoice({ requestId: request._id, files: { xml: [xml], pdf: [pdf] }, user: accounting, req });
        assert.equal(observed.observed, true);
        assert.match(observed.sunatVoucher.observationDetail, /never been downloaded/);
        assert.equal((await FinancialRequest.findById(request._id)).status, "OBSERVADO_SUNAT");
        await assert.rejects(() => approveManualSunatException({ requestId: request._id, voucherId: observed.sunatVoucher._id, reason: "  ", user: accounting, req }), /reason is required/);
        const approved = await approveManualSunatException({ requestId: request._id, voucherId: observed.sunatVoucher._id, reason: "SUNAT CPE service unavailable; PDF checked against supplier portal.", user: accounting, req });
        assert.equal(approved.provisioned, true, approved.detail);
        const ap = await AccountsPayable.findById(approved.accountsPayable._id).populate("sunatVoucher");
        assert.equal(ap.sunatValidation.status, "MANUAL_EXCEPTION");
        assert.match(ap.sunatValidation.manualException.reason, /unavailable/);
        assert.equal(ap.sunatVoucher.validationStatus, "MANUAL_EXCEPTION");
        assert.equal(ap.sunatVoucher.manualOverride.taxpayerUnverified, true);
        assert.ok(await JournalEntry.exists({ _id: ap.provisionJournal, status: "POSTED" }));
        assert.equal((await FinancialRequest.findById(request._id)).status, "CONTABILIZADO");
        assert.ok(await AuditLog.exists({ action: "MANUAL_SUNAT_OVERRIDE", requestId: request._id }));
        await assertNoBlockingObservation(ap);
        await fs.rm(path.resolve(uploadRoot, "requests", String(request._id)), { recursive: true, force: true });

        // A Render restart can remove local uploads after the invoice was observed.
        // Saving the exception must expose that blocker, and an owner retry must reuse it.
        const retryRequest = await makeRequest();
        await reserveBudget(retryRequest, admin._id);
        await PurchaseOrder.create({ poNumber: "FIX-PO-RETRY", request: retryRequest._id, supplier: supplier._id, amount: 1180, currency: "PEN", generatedBy: admin._id });
        const retryVoucher = invoice();
        const firstAttempt = await registerA1Invoice({ requestId: retryRequest._id, files: {
          xml: [await writeTemp("retry.xml", invoiceXml(retryVoucher))],
          pdf: [await writeTemp("retry.pdf", "%PDF-1.4 test")]
        }, user: owner, req });
        const stored = await SunatVoucher.findById(firstAttempt.sunatVoucher._id).select("+xmlPath");
        await fs.unlink(stored.xmlPath);
        const deferred = await approveManualSunatException({ requestId: retryRequest._id, voucherId: stored._id, reason: "UAT manual review", user: accounting, req });
        assert.equal(deferred.provisioned, false);
        assert.match(deferred.detail, /Re-upload the same XML and PDF/);
        assert.equal((await FinancialRequest.findById(retryRequest._id)).observation.code, "INVOICE_POSTING_PENDING");
        assert.equal(await AccountsPayable.countDocuments({ request: retryRequest._id }), 0);
        assert.ok(await AuditLog.exists({ requestId: retryRequest._id, action: "MANUAL_EXCEPTION_POSTING_DEFERRED" }));
        const retry = await registerA1Invoice({ requestId: retryRequest._id, files: {
          xml: [await writeTemp("retry.xml", invoiceXml(retryVoucher))],
          pdf: [await writeTemp("retry.pdf", "%PDF-1.4 test")]
        }, user: owner, req });
        assert.ok(retry.accountsPayable);
        assert.equal(retry.sunatVoucher.validationStatus, "MANUAL_EXCEPTION");
        assert.equal(await AccountsPayable.countDocuments({ request: retryRequest._id }), 1);
        assert.equal(await AuditLog.countDocuments({ requestId: retryRequest._id, action: "MANUAL_SUNAT_OVERRIDE" }), 1);
        await fs.rm(path.resolve(uploadRoot, "requests", String(retryRequest._id)), { recursive: true, force: true });
      } finally {
        if (originalMode === undefined) delete process.env.SUNAT_PROVIDER_MODE; else process.env.SUNAT_PROVIDER_MODE = originalMode;
        if (originalPadronDir === undefined) delete process.env.SUNAT_PADRON_DATA_DIR; else process.env.SUNAT_PADRON_DATA_DIR = originalPadronDir;
        await fs.rm(padronDir, { recursive: true, force: true });
      }
    });

    await t.test("2. invoices land in their document-date period, not the request month; fiscal period must match", async () => {
      const request = await makeRequest({ accountingPeriod: "2026-08" });
      await reserveBudget(request, admin._id);
      const { ap } = await payable(request, invoice({ issueDate: "2026-07-15" }));
      assert.equal(ap.accountingPeriod, "2026-07");
      assert.equal((await JournalEntry.findById(ap.provisionJournal)).period, "2026-07");
      const pending = await makeRequest();
      await assert.rejects(() => processAccountsPayable({ requestId: pending._id, payload: { documentType: "FACTURA", series: "F001", number: "9", documentDate: "2026-08-10", accountingDate: "2026-08-10", fiscalPeriod: "2026-07" }, user: accounting, req }), /booked in the period of their document date/);
      await assert.rejects(() => processAccountsPayable({ requestId: pending._id, payload: { documentType: "07", series: "FC01", number: "9", documentDate: "2026-08-10", accountingDate: "2026-08-10" }, user: accounting, req }), /not a new payable/);
    });

    await t.test("2/7. unpaid posted invoices do not block close; consolidation compares the AP subledger with journals", async () => {
      const request = await makeRequest({ accountingPeriod: "2026-05", issueDate: "2026-05-05" });
      await reserveBudget(request, admin._id);
      await payable(request, invoice({ issueDate: "2026-05-10" }));
      const consolidation = await getConsolidation("2026-05");
      assert.equal(consolidation.summary.transactionSourceTotal, 118);
      assert.equal(consolidation.summary.centralizationTotal, 118);
      assert.equal(consolidation.summary.difference, 0);
      const may2026 = await AccountingPeriod.findOne({ period: "2026-05" });
      const closed = await closeAccountingPeriod({ id: may2026._id, comments: "Month end", user: accounting, req });
      assert.equal(closed.status, "CLOSED", "an unpaid but posted invoice stays as outstanding AP");

      // A payable booked in the period without its provision journal is a real difference.
      const broken = await makeRequest({ accountingPeriod: "2026-04" });
      await AccountsPayable.create({ request: broken._id, supplier: supplier._id, supplierIdentifierSnapshot: supplier.rucDni, voucher: { voucherType: "FACTURA", series: "F404", number: "1" }, accountingPeriod: "2026-04", originalAmount: 50, invoiceAmount: 50, invoicePenEquivalent: 50, currency: "PEN", exchangeRate: 1, penEquivalent: 50, outstandingAmount: 50 });
      const april = await getConsolidation("2026-04");
      assert.equal(april.summary.difference, 50);
      await SunatVoucher.create({ request: broken._id, flowType: "A1", supplier: supplier._id, rucIssuer: supplier.rucDni, voucherType: "FACTURA", series: "F405", number: "1", issueDate: "2026-04-20", xmlAmount: 10, validationStatus: "OBSERVED_SUNAT" });
      const april2026 = await AccountingPeriod.findOne({ period: "2026-04" });
      await assert.rejects(() => closeAccountingPeriod({ id: april2026._id, comments: "Attempt", user: accounting, req }), error => error.details.unpostedInvoices === 1 && error.details.incompletePayables === 1 && error.details.sourceDifference === 50);
    });

    await t.test("3. processAccountsPayable uses the invoice-date exchange rate, not the request date", async () => {
      for (const [date, rate] of [["2026-08-03", 3.7], ["2026-08-20", 3.8]]) {
        await ExchangeRate.create({ currency: "USD", date: new Date(`${date}T00:00:00Z`), period: date.slice(0, 7), rate, source: "SUNAT", providerMode: "SUNAT", authoritative: true });
      }
      const request = await makeRequest({ currency: "USD", issueDate: "2026-08-03", lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }] });
      await reserveBudget(request, admin._id);
      await PurchaseOrder.create({ poNumber: "FIX-PO-USD", request: request._id, supplier: supplier._id, amount: 118, currency: "USD", generatedBy: admin._id });
      const voucher = invoice({ currency: "USD", issueDate: "2026-08-20" });
      const { xmlFile } = await fiscalFixture(request, supplier, voucher, admin, files);
      request.attachments.push({ ...xmlFile, kind: "XML", uploadedBy: admin._id });
      await request.save();
      const result = await processAccountsPayable({ requestId: request._id, payload: { documentType: "01", series: voucher.series, number: voucher.number, documentDate: "2026-08-20", accountingDate: "2026-08-20", fiscalPeriod: "2026-08", accountNumber: "632101" }, user: accounting, req });
      assert.equal(result.accountsPayable.exchangeRate, 3.8);
      assert.equal(result.accountsPayable.penEquivalent, 448.4);
      assert.equal(result.journal.totalCredit, 448.4);
      assert.equal(result.journal.period, "2026-08");
    });

    await t.test("10. a typed posting account must be the Expense Type account", async () => {
      const request = { lines: [{ expenseType: { accountNumber: "632101" } }] };
      assert.doesNotThrow(() => assertPostingAccount(request, "632101"));
      assert.doesNotThrow(() => assertPostingAccount(request, ""));
      assert.throws(() => assertPostingAccount(request, "999999"), /not the account configured/);
    });

    await t.test("5. non-recoverable IGV: boletas, non-deductible expense types and CAPEX asset cost; residuals on the expense line", async () => {
      assert.equal(igvIsRecoverable("BOLETA", opex), false);
      assert.equal(igvIsRecoverable("FACTURA", nonIgv), false);
      assert.equal(igvIsRecoverable("FACTURA", opex), true);
      const boletaRequest = await makeRequest();
      await reserveBudget(boletaRequest, admin._id);
      const { ap: boleta } = await payable(boletaRequest, invoice({ voucherType: "BOLETA", series: "B001" }));
      const boletaJournal = await JournalEntry.findById(boleta.provisionJournal);
      assert.equal(boletaJournal.lines.some(line => line.accountNumber === "401111"), false);
      assert.equal(boletaJournal.lines.find(line => line.accountNumber === "632101").debit, 118);

      const ndRequest = await makeRequest({ lines: [{ costCenter: center._id, expenseType: nonIgv._id, netAmount: 1000, igvAmount: 180, totalAmount: 1180 }] });
      await reserveBudget(ndRequest, admin._id);
      const { ap: nd } = await payable(ndRequest, invoice());
      const ndJournal = await JournalEntry.findById(nd.provisionJournal);
      assert.equal(ndJournal.lines.find(line => line.accountNumber === "659101").debit, 118);
      assert.equal(ndJournal.totalDebit, ndJournal.totalCredit);

      const capexRequest = await makeRequest({ requestType: "CAPEX", expenseNature: "EQUIPMENT", lines: [{ costCenter: center._id, expenseType: capex._id, netAmount: 1000, igvAmount: 180, totalAmount: 1180 }] });
      await reserveBudget(capexRequest, admin._id);
      const { ap: asset } = await payable(capexRequest, invoice({ voucherType: "BOLETA", series: "B002" }));
      const assetLine = (await JournalEntry.findById(asset.provisionJournal)).lines.find(line => line.accountNumber === "336101");
      assert.equal(assetLine.debit, 118);
      assert.match(assetLine.description, /asset cost/);

      const residualRequest = await makeRequest();
      await reserveBudget(residualRequest, admin._id);
      const { ap: residual } = await payable(residualRequest, invoice({ totalAmount: 118.01 }));
      const residualJournal = await JournalEntry.findById(residual.provisionJournal);
      assert.equal(residualJournal.lines.find(line => line.accountNumber === "401111").debit, 18);
      assert.equal(residualJournal.lines.find(line => line.accountNumber === "632101").debit, 100.01);
      const gapVoucher = invoice({ totalAmount: 119 });
      const gapEvidence = await fiscalFixture(residualRequest, supplier, gapVoucher, admin, files);
      await assert.rejects(() => createAccountsPayableFromVoucher({ request: residualRequest, supplier, voucher: gapVoucher, sunatVoucher: gapEvidence.stored, flowType: "A1", user: admin }), error => error.code === "XML_AMOUNT_MISMATCH");
    });

    await t.test("6. cancelling a CXP restores the PO, annuls the voucher, re-syncs the request and posts the reversal now", async () => {
      const request = await makeRequest();
      await reserveBudget(request, admin._id);
      const order = await PurchaseOrder.create({ poNumber: "FIX-PO-CANCEL", request: request._id, supplier: supplier._id, amount: 1180, currency: "PEN", generatedBy: admin._id });
      const voucher = invoice();
      await consumePurchaseOrderBalance(order._id, voucher.totalAmount);
      const { ap, evidence } = await payable(request, voucher, { purchaseOrder: order });
      await syncFinancialProgress({ request, user: admin, req });
      assert.equal(request.status, "CONTABILIZADO");
      assert.equal((await PurchaseOrder.findById(order._id)).remainingAmount, 1062);
      await assert.rejects(() => cancelAccountsPayable({ accountsPayableId: ap._id, reason: "", user: accounting, req }), /reason is required/);
      const result = await cancelAccountsPayable({ accountsPayableId: ap._id, reason: "Supplier issued a corrected invoice", user: accounting, req });
      assert.equal(result.accountsPayable.status, "CANCELLED");
      assert.equal(result.reversalJournal.period, currentPeriod);
      assert.equal(result.reversalJournal.totalDebit, result.reversalJournal.totalCredit);
      assert.equal((await PurchaseOrder.findById(order._id)).remainingAmount, 1180);
      assert.equal((await SunatVoucher.findById(evidence.stored._id)).validationStatus, "ANNULLED");
      assert.equal((await FinancialRequest.findById(request._id)).status, "COMPROMISO_PRESUPUESTAL");
      // The same voucher identity can now be registered again (corrected invoice).
      const reloaded = await FinancialRequest.findById(request._id);
      await consumePurchaseOrderBalance(order._id, voucher.totalAmount);
      const { ap: again } = await payable(reloaded, voucher, { purchaseOrder: order });
      assert.notEqual(String(again._id), String(ap._id));
      assert.equal(again.status, "OPEN");
    });

    await t.test("4. credit notes reduce an unpaid invoice, create a supplier credit on a paid one, and debit notes increase it", async () => {
      let request = await makeRequest();
      await reserveBudget(request, admin._id);
      const unpaidVoucher = invoice();
      const { ap: unpaid } = await payable(request, unpaidVoucher);
      const creditFile = await writeTemp("credit.xml", noteXml({ id: "FC01-00000001", issueDate: "2026-08-12", ruc: supplier.rucDni, netAmount: 10, igvAmount: 1.8, totalAmount: 11.8, reference: `F001-${unpaidVoucher.number}` }));
      const credit = await registerAdjustmentNote({ xmlFile: creditFile, user: accounting, req });
      assert.equal(credit.observed, false);
      assert.equal(String(credit.note.referencedVoucher), String(unpaid.sunatVoucher));
      assert.equal(credit.accountsPayable.outstandingAmount, 106.2);
      assert.equal(credit.accountsPayable.originalAmount, 106.2);
      assert.equal(credit.journal.entryType, "CREDIT_NOTE");
      assert.equal(credit.journal.totalDebit, credit.journal.totalCredit);
      assert.equal(credit.journal.lines.find(line => line.accountNumber === "421201").debit, 11.8);
      await assert.rejects(() => registerAdjustmentNote({ xmlFile: creditFile, user: accounting, req }), error => error.code === "DUPLICATE_VOUCHER");

      const debitFile = await writeTemp("debit.xml", noteXml({ kind: "DebitNote", id: "FD01-1", issueDate: "2026-08-13", ruc: supplier.rucDni, netAmount: 5, igvAmount: 0.9, totalAmount: 5.9, reference: `F001-${unpaidVoucher.number}` }));
      const debit = await registerAdjustmentNote({ xmlFile: debitFile, user: accounting, req });
      assert.equal(debit.accountsPayable.outstandingAmount, 112.1);
      assert.equal(debit.journal.entryType, "DEBIT_NOTE");
      assert.equal(debit.journal.lines.find(line => line.accountNumber === "421201").credit, 5.9);

      request = await FinancialRequest.findById(request._id);
      const paidVoucher = invoice();
      const { ap: paid } = await payable(request, paidVoucher);
      await AccountsPayable.updateOne({ _id: paid._id }, { $set: { status: "PAID", outstandingAmount: 0, paidDate: new Date("2026-08-15") } });
      // No XML reference: the user selects the original invoice.
      const paidCreditFile = await writeTemp("credit-paid.xml", noteXml({ id: "FC01-2", issueDate: "2026-08-16", ruc: supplier.rucDni, netAmount: 20, igvAmount: 3.6, totalAmount: 23.6 }));
      await assert.rejects(() => registerAdjustmentNote({ xmlFile: paidCreditFile, user: accounting, req }), /Select the original invoice/);
      const paidCredit = await registerAdjustmentNote({ xmlFile: paidCreditFile, originalVoucherId: paid.sunatVoucher, user: accounting, req });
      assert.ok(paidCredit.supplierCredit);
      assert.equal(paidCredit.supplierCredit.amount, 23.6);
      assert.equal(paidCredit.journal.lines.find(line => line.accountNumber === "168101").debit, 23.6);
      assert.equal(paidCredit.accountsPayable.status, "PAID");

      request = await FinancialRequest.findById(request._id);
      const nextVoucher = invoice();
      const { ap: next } = await payable(request, nextVoucher);
      const applied = await applySupplierCredit({ supplierCreditId: paidCredit.supplierCredit._id, accountsPayableId: next._id, amount: 20, user: accounting, req });
      assert.equal(applied.accountsPayable.outstandingAmount, 98);
      assert.equal(applied.accountsPayable.status, "PARTIALLY_PAID");
      assert.equal(applied.supplierCredit.remainingAmount, 3.6);
      assert.equal(applied.journal.totalDebit, applied.journal.totalCredit);
      const recovered = await recoverSupplierCredit({ supplierCreditId: paidCredit.supplierCredit._id, bank: "BCP", reference: "REFUND-1", date: "2026-08-20", user: accounting, req });
      assert.equal(recovered.supplierCredit.status, "SETTLED");
      assert.equal(recovered.journal.lines.find(line => line.accountNumber === "104101").debit, 3.6);
    });

    await t.test("9. standalone XLSX is rejected; a ZIP's XLSX list needs an XML per row", async () => {
      const request = await makeRequest();
      await reserveBudget(request, admin._id);
      const order = await PurchaseOrder.create({ poNumber: "FIX-PO-BATCH", request: request._id, supplier: supplier._id, amount: 1180, currency: "PEN", generatedBy: admin._id });
      await assert.rejects(() => createMassUploadBatch({ purchaseOrderId: order._id, files: { batchFile: [{ originalname: "invoices.xlsx" }] }, user: admin, req }), /XLSX on its own cannot post/);
      const listed = invoice({ series: "F055", number: "1" });
      const zip = invoiceZip({
        "F055-1.xml": invoiceXml(listed),
        "F055-1.pdf": "%PDF-1.4 test",
        "invoices.xlsx": xlsxWorkbook([["serie_numero", "ruc", "monto_total"], ["F055-00000001", supplier.rucDni, "118"], ["F055-00000002", supplier.rucDni, "236"]])
      });
      const zipFile = await writeTemp("batch.zip", zip);
      const batch = await MassUploadBatch.create({ batchCode: "FIX-BATCH", request: request._id, purchaseOrder: order._id, uploadedBy: admin._id, inputType: "ZIP", inputFile: { originalName: "batch.zip", filename: zipFile.filename, path: zipFile.path, url: "/unused", size: zip.length }, status: "QUEUED" });
      await processMassUploadBatch(batch._id);
      const saved = await MassUploadBatch.findById(batch._id);
      assert.equal(saved.processedSuccess, 1, JSON.stringify(saved.items));
      const missing = saved.items.find(item => item.errorCode === "XML_MISSING");
      assert.ok(missing, JSON.stringify(saved.items));
      assert.ok(await InvoiceObservation.exists({ batch: batch._id, errorCode: "XML_MISSING" }));
      assert.equal(await AccountsPayable.countDocuments({ request: request._id }), 1);
      await fs.rm(path.resolve(uploadRoot, "requests", String(request._id)), { recursive: true, force: true });
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const file of files) await fs.rm(file, { force: true }).catch(() => undefined);
  }
});
