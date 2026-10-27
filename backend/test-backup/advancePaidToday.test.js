import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import { advancePaymentDate, isPaymentCycleDate, limaDateKey } from "../../shared/businessCalendar.mjs";
import { calculateRequestLineAmounts } from "../../shared/requestLineAmounts.mjs";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import CostCenter from "../src/models/CostCenter.js";
import EmployeeReimbursementBankAccount from "../src/models/EmployeeReimbursementBankAccount.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { ADVANCE_PAYMENT_REASON, advancePaymentDateKey } from "../src/services/advancePaymentService.js";
import { decideApproval } from "../src/services/approvalService.js";
import { verifyBankFile } from "../src/services/bankFileVerificationService.js";
import { createFinancialRequest, getRequestDetail } from "../src/services/requestService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { advancesDueSummary, confirmTreasuryPayable, generatePaymentBatch, previewPaymentBatch, resolvePaymentSchedule } from "../src/services/treasuryService.js";
import { REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const lima = (iso) => new Date(`${iso}-05:00`);

test("an advance is paid the same working day; after 15:00 or on a holiday, the next working day", () => {
  assert.equal(advancePaymentDate(lima("2026-10-19T10:00:00")), "2026-10-19", "Monday morning: today");
  assert.equal(advancePaymentDate(lima("2026-10-19T14:59:00")), "2026-10-19");
  assert.equal(advancePaymentDate(lima("2026-10-19T15:00:00")), "2026-10-20", "from 15:00: the next working day");
  assert.equal(advancePaymentDate(lima("2026-10-23T16:00:00")), "2026-10-26", "Friday afternoon: Monday");
  assert.equal(advancePaymentDate(lima("2026-10-24T09:00:00")), "2026-10-26", "Saturday: Monday");
  assert.equal(advancePaymentDate(lima("2026-12-07T16:00:00")), "2026-12-10", "8 and 9 December are holidays");
  assert.equal(advancePaymentDate(lima("2026-10-19T15:30:00"), { cutoffHour: 18 }), "2026-10-19", "the cut-off is configurable");
});

test("a bank file of advances only is dated today without a typed reason; anything else still needs one", () => {
  const now = lima("2026-10-19T10:00:00");
  assert.throws(() => resolvePaymentSchedule({ paymentDate: "2026-10-19", now }), /A reason is required/);
  assert.deepEqual(resolvePaymentSchedule({ now, advancesOnly: true }), { paymentDate: "2026-10-19", cycleDate: "2026-10-30", override: { reason: ADVANCE_PAYMENT_REASON, cycleDate: "2026-10-30" } });
  assert.equal(resolvePaymentSchedule({ paymentDate: "2026-10-19", reason: "Urgent trip", now, advancesOnly: true }).override.reason, "Urgent trip", "a typed reason is kept");
  assert.equal(resolvePaymentSchedule({ paymentDate: "2026-10-30", now, advancesOnly: true }).override, null, "on a cycle date there is nothing to explain");
});

test("an advance line carries no IGV: the amount is what is paid", () => {
  assert.deepEqual(calculateRequestLineAmounts({ quantity: "1", unitPrice: "56", priceIncludesIGV: true, igvExempt: true }), { unitPrice: 56, subtotal: 56, netAmount: 56, igvAmount: 0, totalAmount: 56 });
  assert.equal(calculateRequestLineAmounts({ quantity: "2", unitPrice: "28", priceIncludesIGV: false, igvExempt: true }).totalAmount, 56, "no 18% on top either");
  assert.deepEqual(calculateRequestLineAmounts({ quantity: "1", unitPrice: "56", priceIncludesIGV: true }), { unitPrice: 56, subtotal: 56, netAmount: 47.46, igvAmount: 8.54, totalAmount: 56 }, "other tracks keep IGV");
});

test("an approved advance goes to Treasury to pay now, and the employee is told where to return leftover money", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_advance_today_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init()]);
    await installBbvaTestConfiguration();
    const today = limaDateKey(new Date());
    const period = today.slice(0, 7);
    await AccountingPeriod.create({ period, status: "OPEN" });
    const center = await CostCenter.create({ code: "AT-CC", name: "Advances", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const opex = await ExpenseType.create({ code: "AT-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const director = await User.create({ name: "AT Director", email: "at.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    const employee = await User.create({ name: "Ruth Camila", dni: "44556699", employeeCode: "UMA-AT-1", email: "at.employee@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id], jefe: director._id });
    const accounting = await User.create({ name: "AT Accounting", email: "at.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "AT Treasury", email: "at.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    await EmployeeReimbursementBankAccount.create({ user: employee._id, bank: "BCP", currency: "PEN", accountHolderName: employee.name, accountNumber: "194100000099", cci: "00219410000000000099", active: true, preferred: true, verificationStatus: "VERIFIED", createdBy: employee._id });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["BANK", "104102", "BBVA"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `AT-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "AT director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });
    const returnAccount = "BBVA Cta. Cte. 0011-0814-0100000000 · CCI 011-814-000100000000-00";
    await FinanceConfiguration.create({ key: "ADVANCE_RETURN_ACCOUNT", textValue: returnAccount, effectiveFrom: new Date(Date.now() - 86400000), active: true });

    const createAdvance = (priceIncludesIGV) => createFinancialRequest({
      payload: {
        flowType: "C", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: "TRAVEL", priority: "MEDIA",
        issueDate: today, accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: "Trip to the school", description: "Trip to the school",
        businessJustification: "School visit", lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(opex._id), itemDescription: "Trip", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "56", priceIncludesIGV }]),
        submit: "true"
      },
      files: {}, user: employee, req
    });

    await t.test("the request keeps S/ 56 with no IGV, whatever the IGV option", async () => {
      for (const priceIncludesIGV of [true, false]) {
        const request = await createAdvance(priceIncludesIGV);
        assert.deepEqual([request.lines[0].netAmount, request.lines[0].igvAmount, request.lines[0].totalAmount, request.totalIGV, request.totalAmount], [56, 0, 56, 0, 56], `priceIncludesIGV ${priceIncludesIGV}`);
        await FinancialRequest.deleteOne({ _id: request._id });
      }
    });

    let advance;
    let payable;
    await t.test("approval sends it to Treasury for today, outside the 15th/30th", async () => {
      const before = await advancePaymentDateKey();
      advance = (await decideApproval({ id: (await createAdvance(true))._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req })).request;
      const after = await advancePaymentDateKey();
      assert.equal(advance.status, REQUEST_STATUS.ACCOUNTED);
      payable = await AccountsPayable.findOne({ request: advance._id });
      assert.ok([before, after].includes(limaDateKey(payable.dueDate)), "due on its pay date, not the next cycle date");
      const notice = await Notification.findOne({ user: treasury._id, eventKey: `request:${advance._id}:treasury` });
      assert.equal(notice.title, "Advance to pay now");
      assert.equal(notice.path, "/treasury?advances=due");
      assert.match(notice.message, /pay the PEN 56\.00 advance to Ruth Camila/);
      const due = limaDateKey(payable.dueDate);
      const summary = await advancesDueSummary(lima(`${due}T18:00:00`));
      assert.equal(summary.count, 1);
      assert.equal(summary.totalsByCurrency.PEN.total, 56);
      assert.equal((await advancesDueSummary(lima(`${due}T18:00:00`).getTime() - 2 * 86400000)).count, 0, "not due before its pay date");
    });

    await t.test("the readiness check passes an employee advance when no account is chosen for it", async () => {
      const clean = await previewPaymentBatch({ payableIds: [String(payable._id)], currency: "PEN", accountSelections: {} });
      assert.deepEqual(clean.issues, [], "the advance goes to its fixed employee destination");
      // What the screen used to send: an account for the advance, which the server refuses.
      const profile = (await FinancialRequest.findById(advance._id)).rendition.reimbursementBankSnapshot.profile;
      const sent = await previewPaymentBatch({ payableIds: [String(payable._id)], currency: "PEN", accountSelections: { [String(payable._id)]: String(profile) } });
      assert.match(sent.issues[0]?.message || "", /immutable rendition bank snapshot/);
    });

    await t.test("Treasury pays it today without a reason; Accounting is asked to verify the file today", async () => {
      const result = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: today, user: treasury, req });
      files.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
      const scheduled = await AccountsPayable.findById(payable._id);
      if (!isPaymentCycleDate(new Date(`${today}T12:00:00Z`))) assert.equal(scheduled.scheduleOverride.reason, ADVANCE_PAYMENT_REASON, "the platform records why it is off the cycle");
      const task = await Notification.findOne({ user: accounting._id, type: "BANK_FILE_VERIFICATION" });
      assert.equal(task.title, "Verify today: bank file with an advance");
      await verifyBankFile({ batchId: result.batch._id, user: accounting, req });
      await confirmTreasuryPayable({ accountsPayableId: payable._id, payload: { operationNumber: "ADV-TODAY-1", paidAt: today, confirmedAmount: 56 }, user: treasury, req });
      const paid = await FinancialRequest.findById(advance._id);
      assert.equal(paid.rendition.status, "PENDING", "the 10 working days start at the payment");
    });

    await t.test("the employee is told where to return money left over", async () => {
      const notice = await Notification.findOne({ user: employee._id, type: "RENDITION_PENDING" });
      assert.ok(notice.message.includes(returnAccount), notice.message);
      assert.equal((await getRequestDetail(advance._id, employee)).advanceReturnAccount, returnAccount);
    });
  } finally {
    for (const file of files) await fs.rm(file, { force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
