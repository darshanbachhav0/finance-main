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
import EmployeeReimbursementBankAccount from "../src/models/EmployeeReimbursementBankAccount.js";
import ExchangeRate from "../src/models/ExchangeRate.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Reconciliation from "../src/models/Reconciliation.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { importStatement, confirmStatementMatch } from "../src/services/reconciliationSuggestionService.js";
import { previewPaymentBatch } from "../src/services/treasuryService.js";
import {
  cancelPaymentBatch,
  confirmTreasuryPayable,
  generatePaymentBatch,
  listDetractionQueue,
  listReconciliationQueue,
  listTreasuryQueue,
  markPaymentBounced,
  recordDetractionDeposit,
  reconcilePayment,
  reprogramBouncedPayment,
  resolvePaymentSchedule,
  schedulePayments
} from "../src/services/treasuryService.js";
import { findSpotCategory, listSpotCategories, setSupplierDetractionAccount, updateSpotCategory } from "../src/services/detractionService.js";
import { verifySupplierBankAccount } from "../src/services/supplierService.js";
import { generatedRoot, tempUploadDir, uploadRoot } from "../src/services/storageService.js";
import { nextPaymentCycleDate } from "../../shared/businessCalendar.mjs";
import { AP_STATUS, EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { roundMoney, sumMoney } from "../src/utils/money.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const today = new Date().toISOString().slice(0, 10);
const period = today.slice(0, 7);
const dayAfter = (key, days = 1) => new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

test("treasury payments: partial payments, payment cycle, bounces, file cancellation, SPOT detracciones and reconciliation", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_treasury_payments_${process.pid}_${Date.now()}`;
  const cleanupPaths = [];
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), PaymentBatch.init(), JournalEntry.init(), Reconciliation.init()]);
    const cycle = upcomingPaymentDate();
    for (const value of new Set([period, cycle.slice(0, 7)])) await AccountingPeriod.create({ period: value, status: "OPEN" });
    const center = await CostCenter.create({ code: "CC-TRE-PAY", name: "Treasury payments", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const plainExpense = await ExpenseType.create({ code: "EXP-TRE-PLAIN", name: "Supplies", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "656101", permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const spotExpense = await ExpenseType.create({ code: "EXP-TRE-SPOT", name: "Consulting", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const admin = await User.create({ name: "Admin", email: "admin-pay@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" });
    const accounting = await User.create({ name: "Accounting", email: "accounting-pay@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Accounting" });
    const treasury = await User.create({ name: "Treasury", email: "treasury-pay@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Treasury" });
    const solicitor = await User.create({ name: "Employee", email: "employee-pay@test.local", dni: "41234567", employeeCode: "UMA-PAY-1", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id });
    await installBbvaTestConfiguration("PEN");
    await installBbvaTestConfiguration("USD");
    await AccountingMapping.create([
      { code: "PAY-AP", name: "AP", purpose: "ACCOUNTS_PAYABLE", accountNumber: "421201", active: true },
      { code: "PAY-BBVA-PEN", name: "BBVA PEN", purpose: "BANK", bank: "BBVA", currency: "PEN", accountNumber: "104101", active: true },
      { code: "PAY-BBVA-USD", name: "BBVA USD", purpose: "BANK", bank: "BBVA", currency: "USD", accountNumber: "104201", active: true }
    ]);

    let supplierSequence = 0;
    async function makeSupplier({ withAccount = true, currency = "PEN" } = {}) {
      supplierSequence += 1;
      const ruc = `2060000${String(supplierSequence).padStart(4, "0")}`;
      const supplier = await Supplier.create({
        identifierType: "RUC", rucDni: ruc, normalizedIdentifier: ruc, legalName: `Supplier ${supplierSequence} SAC`, name: `Supplier ${supplierSequence} SAC`,
        taxpayerStatus: "MANUALLY_VALIDATED", complianceStatus: "COMPLIANT", homologationStatus: "HOMOLOGATED", supplierCode: `PRV-${8000 + supplierSequence}`,
        active: true, status: "ACTIVE"
      });
      const accounts = [];
      if (withAccount) {
        for (const value of [].concat(currency)) {
          accounts.push(await SupplierBankAccount.create({ supplier: supplier._id, bank: "BCP", currency: value, accountType: "CURRENT", accountNumber: `19100${String(supplierSequence).padStart(4, "0")}${value === "USD" ? "2" : "1"}01`, cci: `002191000${String(supplierSequence).padStart(4, "0")}000${value === "USD" ? "2" : "1"}001`, active: true, verificationStatus: "VERIFIED", ownershipResult: "MATCH", createdBy: admin._id }));
        }
      }
      return { supplier, account: accounts[0], accounts };
    }

    let sequence = 0;
    // SPOT follows the expense nature (CONSULTING suggests 022) unless Accounting confirmed a
    // category on the CXP (accountingTreatment).
    async function makePayable({ supplier, amount = 118, currency = "PEN", rate = 1, expenseType = plainExpense, request: existing, accountingTreatment } = {}) {
      sequence += 1;
      const request = existing || await FinancialRequest.create({
        requestNumber: `REQ-2026-7${String(sequence).padStart(4, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: expenseType === spotExpense ? EXPENSE_NATURE.CONSULTING : EXPENSE_NATURE.SERVICES,
        issueDate: today, accountingPeriod: period, currency, supplier: supplier._id, solicitor: solicitor._id, requester: solicitor._id,
        description: "Treasury payment test", status: REQUEST_STATUS.ACCOUNTED,
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: amount, igvAmount: 0, totalAmount: amount }]
      });
      const pen = roundMoney(amount * rate);
      const ap = await AccountsPayable.create({
        request: request._id, flowType: "B", supplier: supplier._id, supplierIdentifierSnapshot: supplier.rucDni,
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series: "F001", number: String(sequence), documentDate: new Date(today) },
        originalAmount: amount, currency, exchangeRate: rate, penEquivalent: pen, outstandingAmount: amount, status: AP_STATUS.OPEN, accountingTreatment
      });
      const provision = await JournalEntry.create({
        request: request._id, accountsPayable: ap._id, period, entryType: "PROVISION", sourceTransaction: `CXP:${request.requestNumber}:${ap._id}`,
        currency, originalAmount: amount, exchangeRate: rate, penEquivalent: pen, generatedBy: accounting._id,
        lines: [{ accountNumber: expenseType.accountNumber, description: "Provision", debit: pen }, { accountNumber: "421201", description: "AP", credit: pen }]
      });
      ap.provisionJournal = provision._id;
      await ap.save();
      return { request, ap };
    }
    async function makeFile(payables, { currency = "PEN", paymentDate = cycle, paymentDateReason } = {}) {
      const result = await generatePaymentBatch({ payableIds: payables.map((ap) => String(ap._id)), bank: "BBVA", currency, paymentDate, paymentDateReason, user: treasury, req });
      cleanupPaths.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      return result.batch;
    }
    const confirm = (ap, operationNumber, confirmedAmount, paidAt = today) => confirmTreasuryPayable({ accountsPayableId: ap._id, payload: { operationNumber, paidAt, confirmedAmount }, user: treasury, req });
    const reload = (ap) => AccountsPayable.findById(ap._id);
    const paymentJournals = (ap) => JournalEntry.find({ accountsPayable: ap._id, entryType: "PAYMENT" }).sort({ createdAt: 1 });
    async function cciLetter() {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filename = `cci-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
      const filePath = path.join(tempUploadDir, filename);
      await fs.writeFile(filePath, "%PDF-1.4\n% signed CCI letter\n");
      return { cciLetter: [{ fieldname: "cciLetter", originalname: "cci-letter.pdf", filename, path: filePath, mimetype: "application/pdf", size: 30 }] };
    }

    await t.test("payments default to the next 15th/30th cycle; other dates need a reason and past dates are refused", async () => {
      assert.equal(resolvePaymentSchedule({}).paymentDate, nextPaymentCycleDate(new Date()));
      assert.equal(resolvePaymentSchedule({ now: new Date("2026-02-20T15:00:00Z") }).paymentDate, "2026-02-28");
      assert.throws(() => resolvePaymentSchedule({ paymentDate: "2020-01-15" }), (error) => error.statusCode === 422 && /past/.test(error.message));
      const offCycle = dayAfter(cycle);
      assert.throws(() => resolvePaymentSchedule({ paymentDate: offCycle }), (error) => error.statusCode === 422 && error.details.field === "paymentDateReason");

      const { supplier } = await makeSupplier();
      const { ap } = await makePayable({ supplier });
      await schedulePayments({ payableIds: [String(ap._id)], bank: "BBVA", currency: "PEN", user: treasury, req });
      const scheduled = await reload(ap);
      assert.equal(scheduled.status, AP_STATUS.SCHEDULED);
      assert.equal(scheduled.scheduledFor.toISOString().slice(0, 10), cycle, "no date given: the next payment cycle is used");
      assert.equal(scheduled.scheduleOverride?.reason, undefined);

      const { ap: urgent } = await makePayable({ supplier });
      await assert.rejects(() => schedulePayments({ payableIds: [String(urgent._id)], bank: "BBVA", currency: "PEN", paymentDate: "2020-01-15", paymentDateReason: "Too late", user: treasury, req }), /past/);
      await assert.rejects(() => schedulePayments({ payableIds: [String(urgent._id)], bank: "BBVA", currency: "PEN", paymentDate: offCycle, user: treasury, req }), /reason is required/);
      assert.equal((await reload(urgent)).status, AP_STATUS.OPEN);
      await schedulePayments({ payableIds: [String(urgent._id)], bank: "BBVA", currency: "PEN", paymentDate: offCycle, paymentDateReason: "Supplier contract requires payment before the cycle", user: treasury, req });
      const overridden = await reload(urgent);
      assert.equal(overridden.scheduledFor.toISOString().slice(0, 10), offCycle);
      assert.equal(overridden.scheduleOverride.reason, "Supplier contract requires payment before the cycle");
      assert.equal(overridden.scheduleOverride.cycleDate, cycle);
      assert.ok(await AuditLog.exists({ entityId: urgent._id, action: "PAYMENT_DATE_OVERRIDE" }));

      const queue = await listTreasuryQueue({ supplier: String(supplier._id) });
      assert.equal(queue.summary.nextPaymentCycleDate, cycle);
      assert.deepEqual(queue.summary.paymentCycles.map((group) => group.date).sort(), [cycle, offCycle].sort());
      assert.equal(queue.data.find((row) => String(row._id) === String(ap._id)).accountsPayable.paymentCycleDate, cycle);
    });

    await t.test("each partial confirmation books only its amount, keyed on the real operation, in the payment month", async () => {
      const { supplier } = await makeSupplier();
      const { request, ap } = await makePayable({ supplier, amount: 118 });
      const firstFile = await makeFile([ap]);
      await confirm(ap, "OP-PART-1", 50);
      let current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PARTIALLY_PAID);
      assert.equal(current.outstandingAmount, 68);
      let journals = await paymentJournals(ap);
      assert.equal(journals.length, 1);
      assert.equal(journals[0].totalDebit, 50, "only the confirmed amount is booked, never the whole CXP");
      assert.equal(journals[0].totalCredit, 50);
      assert.equal(journals[0].sourceTransaction, `PAYMENT:${ap._id}:OP-PART-1`);
      assert.equal(journals[0].period, period, "the journal period is the actual payment date's month");
      assert.equal(journals[0].lines.find((line) => line.credit > 0).accountNumber, "104101");
      const batch = await PaymentBatch.findById(firstFile._id);
      assert.equal(batch.items[0].status, "PARTIALLY_CONFIRMED");
      assert.equal(batch.items[0].confirmedAmount, 50);

      // A retry of the same bank operation is refused before any state change.
      await assert.rejects(() => confirm(ap, "OP-PART-1", 50), (error) => error.statusCode === 409);
      current = await reload(ap);
      assert.equal(current.outstandingAmount, 68, "a duplicate operation never reduces outstanding again");
      assert.equal((await FinancialRequest.findById(request._id)).payment.confirmations.length, 1);
      assert.equal((await paymentJournals(ap)).length, 1);

      // The unpaid remainder can be put into a new payment file.
      const queue = await listTreasuryQueue({ supplier: String(supplier._id) });
      assert.ok(queue.data.some((row) => String(row._id) === String(ap._id) && row.accountsPayable.status === AP_STATUS.PARTIALLY_PAID));
      const secondFile = await makeFile([ap]);
      assert.equal(secondFile.items[0].amount, 68);
      const previous = await PaymentBatch.findById(firstFile._id);
      assert.equal(String(previous.items[0].remainderMovedTo), String(secondFile._id));
      assert.equal(previous.status, "CONFIRMED", "the first file is settled once its remainder moved on");
      current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PAYMENT_FILE_CREATED);
      assert.equal(String(current.paymentBatch), String(secondFile._id));

      await confirm(ap, "OP-PART-2", 68);
      current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PAID);
      assert.equal(current.outstandingAmount, 0);
      journals = await paymentJournals(ap);
      assert.deepEqual(journals.map((journal) => journal.totalDebit), [50, 68]);
      assert.equal(sumMoney(journals.map((journal) => journal.totalDebit)), 118);
      assert.equal(current.paymentJournals.length, 2);
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.PAID);
      assert.equal((await PaymentBatch.findById(secondFile._id)).status, "CONFIRMED");
    });

    await t.test("a partially paid remainder that the bank rejects can bounce and be retried", async () => {
      const { supplier } = await makeSupplier();
      const { ap } = await makePayable({ supplier, amount: 118 });
      await makeFile([ap]);
      await confirm(ap, "OP-PB-1", 18);
      await markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "Bank system timeout", reasonCategory: "TECHNICAL" }, user: treasury, req });
      let current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PAYMENT_BOUNCED);
      await reprogramBouncedPayment({ accountsPayableId: ap._id, payload: {}, files: {}, user: treasury, req });
      current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PARTIALLY_PAID, "the 18 already paid is not forgotten");
      assert.equal(current.paymentBatch, undefined);
      assert.equal(current.outstandingAmount, 100);
      const retry = await makeFile([ap]);
      assert.equal(retry.items[0].amount, 100);
    });

    await t.test("the payment journal uses the CXP currency; USD without an exchange-difference mapping is booked at the CXP rate", async () => {
      const { supplier } = await makeSupplier({ currency: ["PEN", "USD"] });
      const { ap } = await makePayable({ supplier, amount: 100, currency: "USD", rate: 3.7 });
      // A PEN request carrying a USD invoice: the mapping must follow the CXP, not the request.
      await FinancialRequest.updateOne({ _id: ap.request }, { $set: { currency: "PEN" } });
      await makeFile([ap], { currency: "USD" });
      await confirm(ap, "OP-USD-1", 100);
      const [journal] = await paymentJournals(ap);
      assert.equal(journal.currency, "USD");
      const bankLine = journal.lines.find((line) => line.credit > 0);
      assert.equal(bankLine.accountNumber, "104201");
      assert.equal(bankLine.credit, 370);
      assert.match(bankLine.description, /CXP rate/);
      assert.equal(journal.totalDebit, journal.totalCredit);
    });

    await t.test("USD with exchange-difference mappings is booked at the payment-date rate with the difference posted", async () => {
      await AccountingMapping.collection.insertMany([
        { code: "PAY-FX-GAIN", name: "FX gain", purpose: "EXCHANGE_GAIN", requestType: "*", expenseNature: "*", bank: "*", currency: "*", accountNumber: "776101", subAccount: "", active: true },
        { code: "PAY-FX-LOSS", name: "FX loss", purpose: "EXCHANGE_LOSS", requestType: "*", expenseNature: "*", bank: "*", currency: "*", accountNumber: "676101", subAccount: "", active: true }
      ]);
      await ExchangeRate.create({ currency: "USD", date: new Date(`${today}T00:00:00.000Z`), period, rate: 3.8, source: "SUNAT", providerMode: "SUNAT", authoritative: true });
      const { supplier } = await makeSupplier({ currency: "USD" });
      const { ap } = await makePayable({ supplier, amount: 100, currency: "USD", rate: 3.7 });
      await makeFile([ap], { currency: "USD" });
      await confirm(ap, "OP-USD-FX", 100);
      const [journal] = await paymentJournals(ap);
      assert.equal(journal.lines.find((line) => line.accountNumber === "421201").debit, 370, "AP is relieved at the CXP rate");
      assert.equal(journal.lines.find((line) => line.accountNumber === "104201").credit, 380, "the bank at the payment-date rate");
      assert.equal(journal.lines.find((line) => line.accountNumber === "676101").debit, 10, "the exchange loss is posted");
      assert.equal(journal.totalDebit, journal.totalCredit);
      assert.equal(journal.exchangeRate, 3.8);
      await AccountingMapping.deleteMany({ purpose: { $in: ["EXCHANGE_GAIN", "EXCHANGE_LOSS"] } });
    });

    await t.test("a TECHNICAL bounce on a verified account is retried without a new CCI letter", async () => {
      await assert.rejects(() => markPaymentBounced({ accountsPayableId: new mongoose.Types.ObjectId(), payload: { reason: "x" }, user: treasury, req }), (error) => error.details?.field === "reasonCategory");
      const { supplier, account } = await makeSupplier();
      const { ap } = await makePayable({ supplier });
      await makeFile([ap]);
      await markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "BBVA batch processing window closed", reasonCategory: "TECHNICAL", bankReference: "R-01" }, user: treasury, req });
      assert.equal((await SupplierBankAccount.findById(account._id)).verificationStatus, "VERIFIED", "a technical rejection does not flag the account");
      assert.equal((await reload(ap)).bouncedPayment.reasonCategory, "TECHNICAL");
      await reprogramBouncedPayment({ accountsPayableId: ap._id, payload: {}, files: {}, user: treasury, req });
      const current = await reload(ap);
      assert.equal(current.status, AP_STATUS.OPEN);
      assert.equal(current.bouncedPayment.replacementBankDocument, undefined);
      const retry = await makeFile([ap]);
      assert.equal(String(retry.items[0].bankAccount.bankAccountId), String(account._id), "the same verified account is reused");

      // If the account stopped being verified in the meantime, the letter is required after all.
      await markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "Timeout", reasonCategory: "TECHNICAL" }, user: treasury, req });
      await SupplierBankAccount.updateOne({ _id: account._id }, { $set: { verificationStatus: "OBSERVED" } });
      await assert.rejects(() => reprogramBouncedPayment({ accountsPayableId: ap._id, payload: {}, files: {}, user: treasury, req }), (error) => error.code === "MISSING_REQUIRED_DOCUMENT");
    });

    await t.test("a BANK_DETAILS bounce needs a signed CCI letter and blocks the account until re-verified", async () => {
      const { supplier, account } = await makeSupplier();
      const { ap } = await makePayable({ supplier });
      await makeFile([ap]);
      await markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "Account closed by the beneficiary", reasonCategory: "BANK_DETAILS" }, user: treasury, req });
      const flagged = await SupplierBankAccount.findById(account._id);
      assert.equal(flagged.verificationStatus, "OBSERVED");
      assert.equal(String((await reload(ap)).bouncedPayment.flaggedAccount.accountId), String(account._id));
      await assert.rejects(() => reprogramBouncedPayment({ accountsPayableId: ap._id, payload: {}, files: {}, user: treasury, req }), (error) => error.code === "MISSING_REQUIRED_DOCUMENT");
      const files = await cciLetter();
      await reprogramBouncedPayment({ accountsPayableId: ap._id, payload: { comments: "New CCI letter" }, files, user: treasury, req });
      cleanupPaths.push(path.join(uploadRoot, "requests", String(ap.request)));
      const reopened = await reload(ap);
      assert.equal(reopened.status, AP_STATUS.OPEN);
      assert.ok(reopened.bouncedPayment.replacementBankDocument);
      // eligible[0] can no longer pick the bounced account.
      await assert.rejects(() => schedulePayments({ payableIds: [String(ap._id)], bank: "BBVA", currency: "PEN", user: treasury, req }), (error) => error.code === "BANK_DETAILS_MISSING");
      await verifySupplierBankAccount({ supplierId: supplier._id, accountId: account._id, payload: { verificationStatus: "VERIFIED", ownershipResult: "MATCH" }, user: accounting, req });
      await schedulePayments({ payableIds: [String(ap._id)], bank: "BBVA", currency: "PEN", user: treasury, req });
      assert.equal((await reload(ap)).status, AP_STATUS.SCHEDULED);
    });

    await t.test("Track C: reprogramming refreshes the employee destination from the current verified profile", async () => {
      const oldProfile = await EmployeeReimbursementBankAccount.create({ user: solicitor._id, bank: "BCP", currency: "PEN", accountHolderName: "Employee", accountNumber: "191000000701", cci: "00219100000000000701", active: true, preferred: true, verificationStatus: "VERIFIED", createdBy: solicitor._id });
      sequence += 1;
      const request = await FinancialRequest.create({
        requestNumber: `REQ-2026-7${String(sequence).padStart(4, "0")}`, requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: today, accountingPeriod: period, currency: "PEN", solicitor: solicitor._id, requester: solicitor._id,
        description: "Advance", status: REQUEST_STATUS.ACCOUNTED,
        lines: [{ costCenter: center._id, expenseType: plainExpense._id, netAmount: 200, igvAmount: 0, totalAmount: 200 }],
        rendition: { reimbursementBankSnapshot: { profile: oldProfile._id, bank: "BCP", currency: "PEN", accountHolderName: "Employee", accountNumber: "191000000701", cci: "00219100000000000701", verificationStatus: "VERIFIED", capturedAt: new Date() } }
      });
      const ap = await AccountsPayable.create({ request: request._id, flowType: "C", supplierIdentifierSnapshot: solicitor.dni, beneficiarySnapshot: { user: solicitor._id, name: solicitor.name }, originalAmount: 200, currency: "PEN", exchangeRate: 1, penEquivalent: 200, outstandingAmount: 200, status: AP_STATUS.OPEN });
      const provision = await JournalEntry.create({ request: request._id, accountsPayable: ap._id, period, entryType: "ADVANCE", sourceTransaction: `CXP:${request.requestNumber}`, currency: "PEN", originalAmount: 200, exchangeRate: 1, penEquivalent: 200, generatedBy: accounting._id, lines: [{ accountNumber: "141301", description: "Advance", debit: 200 }, { accountNumber: "421201", description: "AP", credit: 200 }] });
      ap.provisionJournal = provision._id;
      await ap.save();
      const first = await makeFile([ap]);
      assert.equal(String(first.items[0].bankAccount.employeeBankAccountId), String(oldProfile._id));
      await markPaymentBounced({ accountsPayableId: ap._id, payload: { reason: "Invalid CCI", reasonCategory: "BANK_DETAILS" }, user: treasury, req });
      assert.equal((await EmployeeReimbursementBankAccount.findById(oldProfile._id)).verificationStatus, "OBSERVED");
      await EmployeeReimbursementBankAccount.updateOne({ _id: oldProfile._id }, { $set: { preferred: false } });
      const newProfile = await EmployeeReimbursementBankAccount.create({ user: solicitor._id, bank: "BCP", currency: "PEN", accountHolderName: "Employee", accountNumber: "191000000702", cci: "00219100000000000702", active: true, preferred: true, verificationStatus: "VERIFIED", createdBy: solicitor._id });
      const files = await cciLetter();
      await reprogramBouncedPayment({ accountsPayableId: ap._id, payload: {}, files, user: treasury, req });
      cleanupPaths.push(path.join(uploadRoot, "requests", String(request._id)));
      const refreshed = await FinancialRequest.findById(request._id).select("+rendition.reimbursementBankSnapshot.accountNumber");
      assert.equal(String(refreshed.rendition.reimbursementBankSnapshot.profile), String(newProfile._id));
      assert.equal(refreshed.rendition.reimbursementBankSnapshot.accountNumber, "191000000702");
      const second = await makeFile([ap]);
      assert.equal(String(second.items[0].bankAccount.employeeBankAccountId), String(newProfile._id));
    });

    await t.test("a generated file can be cancelled (whole or per item) before any confirmation, without a bounce", async () => {
      const { supplier } = await makeSupplier();
      const { request: firstRequest, ap: first } = await makePayable({ supplier });
      const { ap: second } = await makePayable({ supplier });
      const batch = await makeFile([first, second]);
      assert.equal((await FinancialRequest.findById(firstRequest._id)).status, REQUEST_STATUS.BANK_FILE_GENERATED);
      await assert.rejects(() => cancelPaymentBatch({ batchId: batch._id, payload: {}, user: treasury, req }), (error) => error.details?.field === "reason");

      await cancelPaymentBatch({ batchId: batch._id, payload: { reason: "Wrong supplier included", accountsPayableIds: [String(second._id)] }, user: treasury, req });
      let current = await PaymentBatch.findById(batch._id);
      assert.equal(current.status, "GENERATED");
      assert.equal(current.items.find((item) => String(item.accountsPayable) === String(second._id)).status, "CANCELLED");
      const returned = await reload(second);
      assert.equal(returned.status, AP_STATUS.OPEN);
      assert.equal(returned.paymentBatch, undefined);
      assert.equal(returned.bouncedPayment?.bouncedAt, undefined, "no fake bounce is recorded");

      await confirm(first, "OP-CANCEL-1", 118);
      await assert.rejects(() => cancelPaymentBatch({ batchId: batch._id, payload: { reason: "Too late" }, user: treasury, req }), (error) => error.statusCode === 409);

      const { request: thirdRequest, ap: third } = await makePayable({ supplier });
      const file = await makeFile([third]);
      await cancelPaymentBatch({ batchId: file._id, payload: { reason: "Bank file regenerated with corrected date" }, user: treasury, req });
      current = await PaymentBatch.findById(file._id);
      assert.equal(current.status, "CANCELLED");
      assert.equal(current.cancellation.reason, "Bank file regenerated with corrected date");
      assert.equal((await reload(third)).status, AP_STATUS.OPEN);
      const request = await FinancialRequest.findById(thirdRequest._id);
      assert.equal(request.paymentBatch, undefined);
      assert.equal(request.status, REQUEST_STATUS.ACCOUNTED, "the request steps back out of TXT_GENERADO");
      assert.ok(await AuditLog.exists({ entityId: file._id, action: "BBVA_FILE_CANCELLED" }));
      const again = await makeFile([third, second]);
      assert.equal(again.items.length, 2, "cancelled CXPs are back in the payment queue");
    });

    await t.test("SPOT table: seeded rates, effective-dated changes, Accounting/Admin only", async () => {
      const categories = await listSpotCategories();
      const byCode = Object.fromEntries(categories.map((item) => [item.code, item]));
      assert.equal(byCode["037"].rate, 12);
      assert.equal(byCode["022"].rate, 12);
      assert.equal(byCode["019"].rate, 10);
      assert.equal(byCode["030"].rate, 4);
      assert.equal(byCode["027"].minimumAmount, 400);
      assert.equal(byCode["022"].minimumAmount, 700);
      await assert.rejects(() => updateSpotCategory({ code: "019", payload: { rate: 11 }, user: treasury, req }), (error) => error.statusCode === 403);
      const from = dayAfter(today, 400);
      await updateSpotCategory({ code: "019", payload: { rate: 11, effectiveFrom: from }, user: accounting, req });
      assert.equal((await findSpotCategory("019", new Date())).rate, 10, "today's payables keep the current rate");
      assert.equal((await findSpotCategory("019", new Date(`${from}T12:00:00Z`))).rate, 11);
    });

    await t.test("SPOT detraccion: net BBVA transfer plus a separate Banco de la Nacion deposit; PAID only after both", async () => {
      const { supplier } = await makeSupplier();
      await assert.rejects(() => setSupplierDetractionAccount({ supplierId: supplier._id, accountNumber: "00-123-456789", user: treasury, req }), (error) => error.statusCode === 403);
      await setSupplierDetractionAccount({ supplierId: supplier._id, accountNumber: "00-123-456789", user: accounting, req });
      const { request, ap } = await makePayable({ supplier, amount: 1180, expenseType: spotExpense });

      const queue = await listTreasuryQueue({ supplier: String(supplier._id) });
      const row = queue.data.find((item) => String(item._id) === String(ap._id));
      assert.equal(row.accountsPayable.detraction.status, "PENDING");
      assert.equal(row.accountsPayable.detraction.categoryCode, "022");
      assert.equal(row.accountsPayable.detraction.amountPen, 142, "12% of 1,180 rounded to whole soles");
      assert.equal(row.accountsPayable.netPayableAmount, 1038);

      const batch = await makeFile([ap]);
      assert.equal(batch.items[0].amount, 1038, "the BBVA file carries the net amount only");
      await assert.rejects(() => confirm(ap, "OP-SPOT-X", 1100), /net of the pending SPOT detraccion/);
      await confirm(ap, "OP-SPOT-1", 1038);
      let current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PARTIALLY_PAID, "not fully paid until the detraccion is deposited");
      assert.equal(current.outstandingAmount, 142);
      assert.equal((await PaymentBatch.findById(batch._id)).items[0].status, "CONFIRMED");
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.BANK_FILE_GENERATED);
      assert.equal((await listDetractionQueue({})).data.some((item) => String(item._id) === String(ap._id)), true);

      const deposit = (payload) => recordDetractionDeposit({ accountsPayableId: ap._id, payload, user: treasury, req });
      await assert.rejects(() => deposit({ depositDate: today, amount: 142 }), (error) => error.statusCode === 422);
      await assert.rejects(() => deposit({ constancyNumber: "C-1", depositDate: today, amount: 141.6 }), /must equal/);
      await deposit({ constancyNumber: "0012345678", depositDate: today, amount: 142 });
      current = await reload(ap);
      assert.equal(current.status, AP_STATUS.PAID);
      assert.equal(current.outstandingAmount, 0);
      assert.equal(current.detraction.status, "DEPOSITED");
      assert.equal(current.detraction.constancyNumber, "0012345678");
      assert.equal(current.detraction.beneficiaryAccountNumber, "00123456789");
      await assert.rejects(() => deposit({ constancyNumber: "0012345678", depositDate: today, amount: 142 }), (error) => error.statusCode === 409);

      const journals = await paymentJournals(ap);
      assert.equal(journals.length, 2);
      for (const journal of journals) assert.equal(journal.totalDebit, journal.totalCredit);
      const lines = journals.flatMap((journal) => journal.lines);
      assert.equal(sumMoney(lines.filter((line) => line.accountNumber === "421201").map((line) => line.debit)), 1180, "AP is debited for the full amount");
      assert.deepEqual(lines.filter((line) => line.accountNumber === "104101").map((line) => line.credit).sort((a, b) => a - b), [142, 1038], "bank credited for the net payment and the deposit");
      assert.ok(journals.some((journal) => journal.sourceTransaction === `DETRACTION:${ap._id}:0012345678`));
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.PAID);

      // Reconciliation: the statement amount is typed from the bank, never pre-filled.
      const reconciliationQueue = await listReconciliationQueue({ search: request.requestNumber });
      assert.equal(reconciliationQueue.data[0].payment.confirmedAmount, 1180);
      await assert.rejects(() => reconcilePayment({ accountsPayableId: ap._id, payload: { bankReference: "EST-1", statementAmount: 1038 }, user: treasury, req }), /exact matching statement amount/);
      await reconcilePayment({ accountsPayableId: ap._id, payload: { bankReference: "EST-1", statementAmount: 1180 }, user: treasury, req });
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.RECONCILED);
    });

    await t.test("SPOT does not apply at or below the threshold, never to non-SPOT expenses, and needs the supplier's BN account", async () => {
      const { supplier } = await makeSupplier();
      const { ap: small } = await makePayable({ supplier, amount: 700, expenseType: spotExpense });
      const { ap: plain } = await makePayable({ supplier, amount: 5000 });
      const { ap: missingAccount } = await makePayable({ supplier, amount: 2000, expenseType: spotExpense });
      // Accounting's confirmation at invoice time wins over the nature's suggestion, both ways.
      const { ap: clearedByAccounting } = await makePayable({ supplier, amount: 2000, expenseType: spotExpense, accountingTreatment: { spotConfirmed: true, spotCategoryCode: "" } });
      const { ap: setByAccounting } = await makePayable({ supplier, amount: 1000, accountingTreatment: { spotConfirmed: true, spotCategoryCode: "037" } });
      await schedulePayments({ payableIds: [small, plain, missingAccount, clearedByAccounting, setByAccounting].map((ap) => String(ap._id)), bank: "BBVA", currency: "PEN", user: treasury, req });
      assert.equal((await reload(small)).detraction.status, "NOT_APPLICABLE", "S/ 700 does not exceed the threshold");
      assert.equal((await reload(plain)).detraction.status, "NOT_APPLICABLE");
      assert.equal((await reload(clearedByAccounting)).detraction.status, "NOT_APPLICABLE");
      assert.equal((await reload(setByAccounting)).detraction.categoryCode, "037");
      assert.equal((await reload(setByAccounting)).detraction.amountPen, 120);
      assert.equal((await reload(missingAccount)).detraction.amount, 240);
      await assert.rejects(() => recordDetractionDeposit({ accountsPayableId: missingAccount._id, payload: { constancyNumber: "C-9", depositDate: today, amount: 240 }, user: treasury, req }), (error) => error.code === "BANK_DETAILS_MISSING");
      await assert.rejects(() => recordDetractionDeposit({ accountsPayableId: plain._id, payload: { constancyNumber: "C-8", depositDate: today, amount: 1 }, user: treasury, req }), (error) => error.statusCode === 409);
    });

    await t.test("preflight is read-only and statement matching uses confirmed bank execution", async () => {
      const { supplier } = await makeSupplier();
      const { request, ap } = await makePayable({ supplier, amount: 118 });
      const count = await PaymentBatch.countDocuments();
      const preview = await previewPaymentBatch({ payableIds: [String(ap._id)], currency: "PEN" });
      assert.equal(preview.ready, true);
      assert.equal((await reload(ap)).status, AP_STATUS.OPEN);
      assert.equal(await PaymentBatch.countDocuments(), count);
      const csv = `date,reference,currency,amount\n${today},OP-AUTO-1,PEN,118`;
      assert.equal((await importStatement(csv, treasury, req)).rows[0].candidates.length, 0);
      await makeFile([ap]);
      assert.equal((await importStatement(csv, treasury, req)).rows[0].candidates.length, 0, "TXT generation is not payment");
      await confirm(ap, "OP-AUTO-1", 118);
      const imported = await importStatement(csv, treasury, req);
      assert.equal(imported.rows[0].candidates.length, 1);
      await confirmStatementMatch({ id: imported.id, rowIndex: 0, payableId: String(ap._id), user: treasury, req });
      assert.ok((await reload(ap)).reconciliation);
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.RECONCILED);
      assert.equal((await importStatement(csv, treasury, req)).rows[0].candidates.length, 0);
      await assert.rejects(confirmStatementMatch({ id: imported.id, rowIndex: 0, payableId: String(ap._id), user: treasury, req }), /already claimed/);
    });

    await t.test("request-level reconciliation is grouped by currency", async () => {
      const { supplier } = await makeSupplier({ currency: ["PEN", "USD"] });
      const { request, ap: pen } = await makePayable({ supplier, amount: 118 });
      const { ap: usd } = await makePayable({ supplier, amount: 50, currency: "USD", rate: 3.7, request });
      await makeFile([pen]);
      await makeFile([usd], { currency: "USD" });
      await confirm(pen, "OP-MIX-PEN", 118);
      await confirm(usd, "OP-MIX-USD", 50);
      await assert.rejects(() => reconcilePayment({ requestId: request._id, payload: { bankReference: "EST-MIX", statementAmount: 168 }, user: treasury, req }), (error) => error.details?.field === "currency");
      await reconcilePayment({ requestId: request._id, payload: { bankReference: "EST-PEN", statementAmount: 118, currency: "PEN" }, user: treasury, req });
      const records = await Reconciliation.find({ request: request._id });
      assert.equal(records.length, 1);
      assert.equal(records[0].currency, "PEN");
      await reconcilePayment({ requestId: request._id, payload: { bankReference: "EST-USD", statementAmount: 50 }, user: treasury, req });
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.RECONCILED);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await Promise.all(cleanupPaths.map((target) => fs.rm(target, { recursive: true, force: true }).catch(() => undefined)));
  }
});
