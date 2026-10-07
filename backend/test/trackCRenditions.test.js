import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import Reconciliation from "../src/models/Reconciliation.js";
import User from "../src/models/User.js";
import { decideApproval } from "../src/services/approvalService.js";
import { createEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { recoverRejectedRendition, rejectionRecoveryAmounts, reviewRendition, submitRendition } from "../src/services/renditionService.js";
import { closeFinancialRequest, createFinancialRequest, normalizeRequestTypeForTrack } from "../src/services/requestService.js";
import { confirmTreasuryPayable, generatePaymentBatch, reconcilePayment, renditionDueDate } from "../src/services/treasuryService.js";
import { verifyBankFile } from "../src/services/bankFileVerificationService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { AP_STATUS, ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { installBbvaTestConfiguration, upcomingPaymentDate } from "./bbvaFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
const issueDate = "2026-09-10";

test("Track C request types: advances default, undocumented reimbursement is accepted", () => {
  assert.equal(normalizeRequestTypeForTrack("C", REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO), REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO);
  assert.equal(normalizeRequestTypeForTrack("C", REQUEST_TYPE.ENTREGA_RENDIR), REQUEST_TYPE.ENTREGA_RENDIR);
  assert.equal(normalizeRequestTypeForTrack("C", REQUEST_TYPE.OPEX), REQUEST_TYPE.ENTREGA_RENDIR);
  assert.equal(normalizeRequestTypeForTrack("C", undefined), REQUEST_TYPE.ENTREGA_RENDIR);
  assert.throws(() => normalizeRequestTypeForTrack("A1", REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO), /only allow CAPEX or OPEX/);
});

test("rejection recovers only the advance balance the employee still holds", () => {
  assert.deepEqual(rejectionRecoveryAmounts({ requestType: REQUEST_TYPE.ENTREGA_RENDIR, rendition: { amountAdvanced: 100, amountReturned: 40 } }), { advanceAmount: 100, returnedAmount: 40, outstandingAmount: 60 });
  assert.deepEqual(rejectionRecoveryAmounts({ requestType: REQUEST_TYPE.ENTREGA_RENDIR, rendition: { amountAdvanced: 100, amountReturned: 100 } }), { advanceAmount: 100, returnedAmount: 100, outstandingAmount: 0 });
  assert.deepEqual(rejectionRecoveryAmounts({ requestType: REQUEST_TYPE.ENTREGA_RENDIR, rendition: { amountAdvanced: 100, amountReturned: 0 } }), { advanceAmount: 100, returnedAmount: 0, outstandingAmount: 100 });
  assert.equal(rejectionRecoveryAmounts({ requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, rendition: {} }).outstandingAmount, 0);
});

test("Track C advances, renditions, recovery and undocumented reimbursements", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_track_c_renditions_${process.pid}_${Date.now()}`;
  const port = Number(process.env.TEST_MONGODB_PORT || 27017);
  await mongoose.connect(`mongodb://127.0.0.1:${port}/${databaseName}`);
  const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), Reconciliation.init(), JournalEntry.init(), Notification.init()]);
    await installBbvaTestConfiguration();
    const center = await CostCenter.create({ code: "TC-CC", name: "Track C", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const opex = await ExpenseType.create({ code: "TC-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const nonDeductible = await ExpenseType.create({ code: "TC-ND", name: "Undocumented expense", category: "NON_DEDUCTIBLE", accountingClass: "NON_DEDUCTIBLE", accountNumber: "659901", deductible: false, permittedRequestTypes: [REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO], active: true });
    const owner = await User.create({ name: "Track C Employee", dni: "44556677", employeeCode: "UMA-TC-1", email: "tc.owner@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id] });
    const director = await User.create({ name: "Track C Director", email: "tc.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    owner.jefe = director._id;
    await owner.save();
    const accounting = await User.create({ name: "Track C Accounting", email: "tc.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const accounting2 = await User.create({ name: "Track C Accounting 2", email: "tc.accounting2@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "Track C Treasury", email: "tc.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    const admin = await User.create({ name: "Track C Admin", email: "tc.admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" });
    await AccountingPeriod.create({ period, status: "OPEN" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["BANK", "104102", "BBVA"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `TC-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "Track C director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });

    const makeBatch = async (payable) => {
      const result = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: upcomingPaymentDate(), user: treasury, req });
      files.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      // Accounting releases the TXT before Treasury sends it to the bank.
      await verifyBankFile({ batchId: result.batch._id, user: accounting, req });
      return result;
    };
    const createTrackC = (requestType, amount, expenseType = opex, extra = {}) => createFinancialRequest({
      payload: {
        flowType: "C", requestType, expenseNature: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "TRAVEL" : "REIMBURSEMENT_LIQUIDATION", priority: "MEDIA",
        issueDate, accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: `${requestType} request`, description: "Track C activity",
        businessJustification: "Approved academic activity", lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(expenseType._id), itemDescription: "Activity", netAmount: amount, igvAmount: 0, totalAmount: amount }]),
        submit: "true", ...extra
      },
      files: {}, user: owner, req
    });
    const approve = async (request) => (await decideApproval({ id: request._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req })).request;

    await t.test("5. nobody verifies their own reimbursement bank account or details they entered", async () => {
      const own = await createEmployeeReimbursementBankAccount({ payload: { ownerId: String(accounting._id), bank: "BCP", currency: "PEN", accountHolderName: accounting.name, accountNumber: "1941000000091", cci: "00219410000000000091", preferred: true }, user: admin, req });
      await assert.rejects(() => reviewEmployeeReimbursementBankAccount({ accountId: own._id, payload: { result: "VERIFIED" }, user: accounting, req }), (error) => error.code === ERROR_CODES.FORBIDDEN && error.details?.segregationOfDuties);
      await assert.rejects(() => reviewEmployeeReimbursementBankAccount({ accountId: own._id, payload: { result: "VERIFIED" }, user: admin, req }), (error) => error.code === ERROR_CODES.FORBIDDEN && error.details?.segregationOfDuties);
      const verified = await reviewEmployeeReimbursementBankAccount({ accountId: own._id, payload: { result: "VERIFIED" }, user: accounting2, req });
      assert.equal(verified.verificationStatus, "VERIFIED");
    });

    const ownerBank = await createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: owner.name, accountNumber: "1941000000001", cci: "00219410000000000001", preferred: true }, user: owner, req });
    await reviewEmployeeReimbursementBankAccount({ accountId: ownerBank._id, payload: { result: "VERIFIED" }, user: accounting, req });

    await t.test("3. rendition deadline counts Peruvian working days and ends on the due day", async () => {
      // Fri 24 Jul 2026: skips 28-29 Jul (Fiestas Patrias), 6 Aug (Junín) and weekends.
      const due = await renditionDueDate("2026-07-24");
      assert.equal(due.toISOString(), "2026-08-13T04:59:59.999Z", "10 working days -> Wed 12 Aug 2026, end of day Lima");
      // Paid on Saturday 29 Aug: Sunday 30 Aug is Santa Rosa; counting starts Monday 31 Aug.
      assert.equal((await renditionDueDate("2026-08-29")).toISOString(), "2026-09-15T04:59:59.999Z");
      await FinanceConfiguration.create({ key: "RENDITION_OVERDUE_DAYS", numericValue: 3, currency: "PEN", behavior: "INFORMATION", effectiveFrom: new Date("2027-01-01"), active: true, createdBy: admin._id });
      // Fri 8 Jan 2027 + 3 working days -> Wed 13 Jan 2027.
      assert.equal((await renditionDueDate("2027-01-08")).toISOString(), "2027-01-14T04:59:59.999Z");
    });

    let advance;
    let advancePayable;
    await t.test("3. the rendition-due notice is sent once, on full payment, with the real date", async () => {
      advance = await createTrackC(REQUEST_TYPE.ENTREGA_RENDIR, 100);
      assert.equal(advance.status, REQUEST_STATUS.PENDING_APPROVAL);
      advance = await approve(advance);
      assert.equal(advance.status, REQUEST_STATUS.ACCOUNTED);
      advancePayable = await AccountsPayable.findOne({ request: advance._id });
      await makeBatch(advancePayable);
      await confirmTreasuryPayable({ accountsPayableId: advancePayable._id, payload: { operationNumber: "ADV-OP-1", paidAt: "2026-09-18", confirmedAmount: 40 }, user: treasury, req });
      let loaded = await FinancialRequest.findById(advance._id);
      assert.notEqual(loaded.rendition.status, "PENDING", "a partial payment does not open the rendition");
      assert.equal(await Notification.countDocuments({ user: owner._id, type: "RENDITION_PENDING" }), 0);
      await confirmTreasuryPayable({ accountsPayableId: advancePayable._id, payload: { operationNumber: "ADV-OP-2", paidAt: "2026-09-18", confirmedAmount: 60 }, user: treasury, req });
      loaded = await FinancialRequest.findById(advance._id);
      assert.equal(loaded.rendition.status, "PENDING");
      // Fri 18 Sep 2026 + 10 working days -> Fri 2 Oct 2026.
      assert.equal(loaded.rendition.dueAt.toISOString(), "2026-10-03T04:59:59.999Z");
      const notices = await Notification.find({ user: owner._id, type: "RENDITION_PENDING" });
      assert.equal(notices.length, 1);
      assert.match(notices[0].message, /02\/10\/2026/);
      assert.doesNotMatch(notices[0].message, /10 days/);
    });

    await t.test("1. only an overdue rendition that was not submitted blocks a new advance", async () => {
      const past = new Date(Date.now() - 2 * 86400000);
      const future = new Date(Date.now() + 5 * 86400000);
      const setRendition = (status, dueAt) => FinancialRequest.updateOne({ _id: advance._id }, { $set: { "rendition.status": status, "rendition.dueAt": dueAt } });

      await setRendition("PENDING", past);
      await assert.rejects(() => createTrackC(REQUEST_TYPE.ENTREGA_RENDIR, 50), (error) => error.code === ERROR_CODES.OVERDUE_RENDITION && error.details.renditionStatus === "PENDING");

      await setRendition("OBSERVED", past);
      await assert.rejects(() => createTrackC(REQUEST_TYPE.ENTREGA_RENDIR, 50), (error) => error.code === ERROR_CODES.OVERDUE_RENDITION && error.details.renditionStatus === "OBSERVED");

      await setRendition("SUBMITTED", past);
      const whilePendingReview = await createTrackC(REQUEST_TYPE.ENTREGA_RENDIR, 50);
      assert.equal(whilePendingReview.status, REQUEST_STATUS.PENDING_APPROVAL, "a rendition submitted and awaiting Accounting never blocks");

      await setRendition("OBSERVED", future);
      const beforeDeadline = await createTrackC(REQUEST_TYPE.ENTREGA_RENDIR, 50);
      assert.equal(beforeDeadline.status, REQUEST_STATUS.PENDING_APPROVAL, "several advances may be open at once");

      await setRendition("PENDING", past);
      const reimbursementWhileOverdue = await createTrackC(REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, 10, nonDeductible);
      assert.equal(reimbursementWhileOverdue.status, REQUEST_STATUS.PENDING_APPROVAL, "the overdue rule restricts new advances only");

      await setRendition("PENDING", future);
    });

    await t.test("2 and 6. a rejected rendition recovers only the unreturned balance, evidenced by bank operation", async () => {
      let loaded = await FinancialRequest.findById(advance._id);
      loaded.attachments.push({ kind: "RENDITION", originalName: "rendition.pdf", filename: "rendition.pdf", url: "/test/rendition.pdf", mimetype: "application/pdf", size: 10, uploadedBy: owner._id });
      await loaded.save();
      await submitRendition({ requestId: advance._id, user: owner, req, files: {}, payload: {
        lines: [{ costCenter: center._id, expenseType: opex._id, netAmount: 60, igvAmount: 0, totalAmount: 60 }],
        mobilityLines: [{ date: "2026-09-18", origin: "UMA", destination: "Hospital", servicePurpose: "Approved activity", amount: 60 }],
        unsupportedExpenseLines: [], amountReturned: 40, beneficiaryAcknowledged: true
      } });
      const rejected = await reviewRendition({ requestId: advance._id, action: "REJECT", comments: "Expenses do not relate to the approved activity", user: accounting, req });
      assert.equal(rejected.rendition.status, "REJECTED");
      assert.equal(rejected.rendition.recovery.status, "PENDING");
      assert.equal(rejected.rendition.recovery.advanceAmount, 100);
      assert.equal(rejected.rendition.recovery.returnedAmount, 40);
      assert.equal(rejected.rendition.recovery.outstandingAmount, 60, "the 40 already returned is not recovered again");
      const returnJournal = await JournalEntry.findById(rejected.rendition.recovery.returnJournal);
      assert.equal(returnJournal.penEquivalent, 40);
      assert.equal(returnJournal.totalDebit, returnJournal.totalCredit);

      const recover = (payload) => recoverRejectedRendition({ requestId: advance._id, user: accounting, req, ...payload });
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 20, reference: "free text", operationDate: "2026-09-20" }), (error) => error.code === ERROR_CODES.VALIDATION_ERROR && error.details.fields.includes("operationNumber"));
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 20, operationNumber: "BCP-001" }), (error) => error.code === ERROR_CODES.VALIDATION_ERROR && error.details.fields.includes("operationDate"));
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 20, operationNumber: "BCP-001", operationDate: "not-a-date" }), (error) => error.details?.field === "operationDate");
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 20, operationNumber: "BCP-001", operationDate: new Date(Date.now() + 3 * 86400000).toISOString() }), /future/);
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 60.01, operationNumber: "BCP-001", operationDate: "2026-09-20" }), (error) => error.details?.outstanding === 60);
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 0, operationNumber: "BCP-001", operationDate: "2026-09-20" }), (error) => error.code === ERROR_CODES.VALIDATION_ERROR);

      let result = await recover({ method: "REIMBURSEMENT", amount: 25, operationNumber: "BCP-001", operationDate: "2026-09-20" });
      assert.equal(result.request.rendition.recovery.outstandingAmount, 35);
      const settlement = result.request.rendition.recovery.settlements[0];
      assert.equal(settlement.operationNumber, "BCP-001");
      assert.equal(settlement.operationDate.toISOString().slice(0, 10), "2026-09-20");
      assert.equal(settlement.amount, 25);
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 5, operationNumber: "bcp-001", operationDate: "2026-09-21" }), (error) => error.code === ERROR_CODES.CONFLICT);
      await assert.rejects(() => recover({ method: "PAYROLL_DEDUCTION", amount: 35 }), (error) => error.details?.field === "reference");
      result = await recover({ method: "PAYROLL_DEDUCTION", amount: 35, reference: "PLANILLA-2026-09" });
      assert.equal(result.request.rendition.recovery.outstandingAmount, 0);
      assert.equal(result.request.rendition.recovery.status, "RECOVERED");
      await assert.rejects(() => recover({ method: "REIMBURSEMENT", amount: 1, operationNumber: "BCP-002", operationDate: "2026-09-21" }), (error) => error.code === ERROR_CODES.INVALID_STATUS_TRANSITION);
      const settlementJournals = await JournalEntry.find({ request: advance._id, entryType: "RENDITION_SETTLEMENT" });
      assert.equal(settlementJournals.reduce((sum, journal) => sum + journal.penEquivalent, 0), 100, "returned + recovered equals the advance, never more");
    });

    await t.test("4. an undocumented reimbursement (REEMBOLSO_SIN_SUSTENTO) walks from the form to closure", async () => {
      let reimbursement = await createTrackC(REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, 80, nonDeductible);
      assert.equal(reimbursement.flowType, "C");
      assert.equal(reimbursement.requestType, REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO);
      assert.equal(reimbursement.status, REQUEST_STATUS.PENDING_APPROVAL);

      reimbursement = await approve(reimbursement);
      assert.equal(reimbursement.status, REQUEST_STATUS.BUDGET_COMMITTED, "no advance is paid; the budget is committed for the declaration");
      assert.ok(reimbursement.budgetCommitment);
      assert.equal(await AccountsPayable.countDocuments({ request: reimbursement._id }), 0);
      assert.equal(await Notification.countDocuments({ user: owner._id, eventKey: `request:${reimbursement._id}:rendition`, resolvedAt: null }), 1);

      reimbursement = await submitRendition({ requestId: reimbursement._id, user: owner, req, files: {}, payload: {
        unsupportedExpenseLines: [{ date: "2026-09-09", description: "Taxi without receipt to the approved activity", goodsServiceType: "SERVICES", grossAmount: 80 }],
        confirmedExceptionalUse: true, exceptionalUseComments: "Provider could not issue a receipt.", beneficiaryAcknowledged: true, reimbursementBankProfile: String(ownerBank._id)
      } });
      assert.equal(reimbursement.rendition.status, "SUBMITTED");
      assert.equal(reimbursement.rendition.reimbursementBankSnapshot.verificationStatus, "VERIFIED");

      const approved = await reviewRendition({ requestId: reimbursement._id, action: "APPROVE", comments: "Declaration accepted", user: accounting, req });
      assert.equal(approved.request.rendition.status, "VALIDATED");
      assert.equal(approved.request.status, REQUEST_STATUS.ACCOUNTED);
      const payable = await AccountsPayable.findOne({ request: reimbursement._id });
      assert.equal(payable.originalAmount, 80);
      assert.equal(payable.flowType, "C");
      const provision = await JournalEntry.findById(payable.provisionJournal);
      assert.equal(provision.entryType, "PROVISION");
      assert.ok(provision.lines.some((line) => line.accountNumber === "659901" && line.debit === 80));
      const commitment = await mongoose.model("BudgetCommitment").findOne({ request: reimbursement._id });
      assert.equal(commitment.executedAmount, 80);

      const { batch } = await makeBatch(payable);
      assert.equal(batch.items[0].bankAccount.cci, "00219410000000000001", "paid to the employee's verified reimbursement account");
      await confirmTreasuryPayable({ accountsPayableId: payable._id, payload: { operationNumber: "REIMB-OP-1", paidAt: "2026-09-21", confirmedAmount: 80 }, user: treasury, req });
      const paidCommitment = await mongoose.model("BudgetCommitment").findOne({ request: reimbursement._id });
      assert.equal(paidCommitment?.paidAmount, 80, "the reimbursement payment is recorded against the budget");
      let loaded = await FinancialRequest.findById(reimbursement._id);
      assert.equal(loaded.status, REQUEST_STATUS.PAID);
      assert.equal(loaded.rendition.status, "VALIDATED", "payment does not reopen a rendition for a reimbursement");
      assert.ok(await Notification.exists({ user: owner._id, type: "PAYMENT_CONFIRMED", eventKey: `request:${reimbursement._id}:paid:${payable._id}` }));

      await reconcilePayment({ accountsPayableId: payable._id, payload: { bankReference: "STM-REIMB-1", statementAmount: 80 }, user: treasury, req });
      loaded = await FinancialRequest.findById(reimbursement._id);
      assert.equal(loaded.status, REQUEST_STATUS.RECONCILED);
      const closed = await closeFinancialRequest({ id: reimbursement._id, user: accounting, req, comments: "Reimbursed" });
      assert.equal(closed.status, REQUEST_STATUS.CLOSED);
    });
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true })));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
