import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import EmployeeReimbursementBankAccount from "../src/models/EmployeeReimbursementBankAccount.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { commitApprovedRequestBudget, decideApproval } from "../src/services/approvalService.js";
import { createEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { createFinancialRequest } from "../src/services/requestService.js";
import { ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";

test("an approved advance waits for the employee's bank account, then pays out on its own", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_advance_bank_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init()]);
    const center = await CostCenter.create({ code: "AB-CC", name: "Advances", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const opex = await ExpenseType.create({ code: "AB-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const nonDeductible = await ExpenseType.create({ code: "AB-ND", name: "Undocumented expense", category: "NON_DEDUCTIBLE", accountingClass: "NON_DEDUCTIBLE", accountNumber: "659901", deductible: false, permittedRequestTypes: [REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO], active: true });
    const director = await User.create({ name: "AB Director", email: "ab.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    const employee = (n) => User.create({ name: `AB Employee ${n}`, dni: `4455660${n}`, employeeCode: `UMA-AB-${n}`, email: `ab.employee${n}@test.local`, passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id], jefe: director._id });
    const [first, second, third] = [await employee(1), await employee(2), await employee(3)];
    const accounting = await User.create({ name: "AB Accounting", email: "ab.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "AB Treasury", email: "ab.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    const management = await User.create({ name: "AB Gerencia", email: "ab.gerencia@test.local", passwordHash: "unused", role: ROLES.MANAGEMENT, approvalLevel: "RECTORATE", area: "Gerencia" });
    await AccountingPeriod.create({ period, status: "OPEN" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `AB-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "AB director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });

    const createAdvance = (owner, { requestType = REQUEST_TYPE.ENTREGA_RENDIR, expenseType = opex, amount = 56 } = {}) => createFinancialRequest({
      payload: {
        flowType: "C", requestType, expenseNature: requestType === REQUEST_TYPE.ENTREGA_RENDIR ? "TRAVEL" : "REIMBURSEMENT_LIQUIDATION", priority: "MEDIA",
        issueDate: "2026-09-10", accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: "Trip to the school", description: "Trip to the school",
        businessJustification: "School visit", lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(expenseType._id), itemDescription: "Trip", netAmount: amount, igvAmount: 0, totalAmount: amount }]),
        submit: "true"
      },
      files: {}, user: owner, req
    });
    const approve = async (request) => (await decideApproval({ id: request._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req })).request;
    const bankFor = (owner, n, extra = {}) => createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: owner.name, accountNumber: `19410000000${n}`, cci: `0021941000000000000${n}`, ...extra }, user: owner, req });

    let waiting;
    await t.test("without a verified bank account the advance waits, approved, and the employee is told", async () => {
      waiting = await approve(await createAdvance(first));
      assert.equal(waiting.status, REQUEST_STATUS.APPROVED, "the approval is kept");
      assert.equal(waiting.observation.code, ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
      assert.equal(waiting.observation.resolver, "REQUESTER");
      assert.equal(await AccountsPayable.countDocuments({ request: waiting._id }), 0);
      const notice = await Notification.findOne({ user: first._id, eventKey: `request:${waiting._id}:advance-bank-needed` });
      assert.equal(notice?.path, "/reimbursement-bank");
      assert.match(notice.message, /Register your bank account in PEN/);
      assert.equal(await Notification.countDocuments({ eventKey: `request:${waiting._id}:budget-commitment` }), 0, "nothing for Treasury to retry");
      assert.ok(await AuditLog.exists({ entityId: waiting._id, action: "ADVANCE_WAITING_FOR_BANK_ACCOUNT" }));
      // Treasury's manual retry still says why.
      const loaded = await FinancialRequest.findById(waiting._id);
      await assert.rejects(() => commitApprovedRequestBudget({ request: loaded, user: treasury, req }), (error) => error.code === ERROR_CODES.REIMBURSEMENT_BANK_REQUIRED);
      assert.equal((await FinancialRequest.findById(waiting._id)).status, REQUEST_STATUS.APPROVED);
    });

    await t.test("verifying the account releases the advance, even when it is not marked preferred", async () => {
      const account = await bankFor(first, 1);
      assert.equal(account.preferred, false);
      assert.equal((await FinancialRequest.findById(waiting._id)).status, REQUEST_STATUS.APPROVED, "a pending account does not release it");
      await reviewEmployeeReimbursementBankAccount({ accountId: account._id, payload: { result: "VERIFIED" }, user: accounting, req });
      const released = await FinancialRequest.findById(waiting._id);
      assert.equal(released.status, REQUEST_STATUS.ACCOUNTED);
      assert.ok(released.observation.resolvedAt, "the hold is cleared");
      assert.equal(String(released.rendition.reimbursementBankSnapshot.profile), String(account._id));
      assert.equal(await AccountsPayable.countDocuments({ request: waiting._id }), 1);
      assert.ok((await Notification.findOne({ user: first._id, eventKey: `request:${waiting._id}:advance-bank-needed` })).resolvedAt);
      assert.ok(await Notification.exists({ user: treasury._id, eventKey: `request:${waiting._id}:treasury` }), "Treasury is told it can pay");
    });

    await t.test("an account already waiting for review sends Accounting to verify it", async () => {
      const pending = await bankFor(second, 2, { preferred: true });
      const held = await approve(await createAdvance(second));
      assert.equal(held.status, REQUEST_STATUS.APPROVED);
      assert.equal(held.observation.resolver, "ACCOUNTING");
      const task = await Notification.findOne({ user: accounting._id, eventKey: `request:${held._id}:advance-bank-review` });
      assert.equal(task?.path, `/reimbursement-bank?record=${pending._id}`);
      assert.match((await Notification.findOne({ user: second._id, eventKey: `request:${held._id}:advance-bank-needed` })).message, /waiting for Accounting's verification/);
      await reviewEmployeeReimbursementBankAccount({ accountId: pending._id, payload: { result: "VERIFIED" }, user: accounting, req });
      assert.equal((await FinancialRequest.findById(held._id)).status, REQUEST_STATUS.ACCOUNTED);
      assert.ok((await Notification.findById(task._id)).resolvedAt);
    });

    await t.test("whoever gives the final approval, the automatic step runs (a Gerencia jefe included)", async () => {
      // A request whose final approval came from Management: before the fix the role check on
      // the automatic step refused it and the advance stalled at APROBADO.
      const advance = await approve(await createAdvance(third));
      assert.equal(advance.status, REQUEST_STATUS.APPROVED, "held: no bank account yet");
      await EmployeeReimbursementBankAccount.create({ user: third._id, bank: "BCP", currency: "PEN", accountHolderName: third.name, accountNumber: "194100000003", cci: "00219410000000000003", active: true, preferred: true, verificationStatus: "VERIFIED", createdBy: third._id });
      await commitApprovedRequestBudget({ request: await FinancialRequest.findById(advance._id), user: management, req, automatic: true });
      assert.equal((await FinancialRequest.findById(advance._id)).status, REQUEST_STATUS.ACCOUNTED);

      const reimbursement = await createAdvance(third, { requestType: REQUEST_TYPE.REEMBOLSO_SIN_SUSTENTO, expenseType: nonDeductible, amount: 45 });
      await FinancialRequest.updateOne({ _id: reimbursement._id }, { $set: { status: REQUEST_STATUS.APPROVED, approvalStage: "COMPLETE", "approvalRouteSnapshot.$[].status": "APPROVED" } });
      await commitApprovedRequestBudget({ request: await FinancialRequest.findById(reimbursement._id), user: management, req, automatic: true });
      assert.equal((await FinancialRequest.findById(reimbursement._id)).status, REQUEST_STATUS.BUDGET_COMMITTED);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
