import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import { limaDateKey } from "../../shared/businessCalendar.mjs";
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
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { useCurrentBankAccountForAdvance } from "../src/services/advanceDestinationService.js";
import { decideApproval } from "../src/services/approvalService.js";
import { createEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount, updateEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { createFinancialRequest } from "../src/services/requestService.js";
import { generatedRoot } from "../src/services/storageService.js";
import { addSupplierBankAccount } from "../src/services/supplierService.js";
import { generatePaymentBatch } from "../src/services/treasuryService.js";
import { ERROR_CODES, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const snapshotFields = "+rendition.reimbursementBankSnapshot.accountNumber +rendition.reimbursementBankSnapshot.cci";

test("an unpaid advance follows the employee's corrected, verified bank account", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_advance_refresh_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init()]);
    await installBbvaTestConfiguration();
    const today = limaDateKey(new Date());
    const period = today.slice(0, 7);
    await AccountingPeriod.create({ period, status: "OPEN" });
    const center = await CostCenter.create({ code: "AR-CC", name: "Advances", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const opex = await ExpenseType.create({ code: "AR-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const director = await User.create({ name: "AR Director", email: "ar.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    const employee = (n) => User.create({ name: `AR Employee ${n}`, dni: `4455667${n}`, employeeCode: `UMA-AR-${n}`, email: `ar.employee${n}@test.local`, passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, authorizedCostCenters: [center._id], jefe: director._id });
    const [ruth, second] = [await employee(1), await employee(2)];
    const accounting = await User.create({ name: "AR Accounting", email: "ar.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "AR Treasury", email: "ar.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["BANK", "104102", "BBVA"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `AR-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "AR director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });
    const verifiedBbva = (owner, accountNumber, cci) => EmployeeReimbursementBankAccount.create({ user: owner._id, bank: "BBVA", currency: "PEN", accountHolderName: owner.name, accountNumber, cci, active: true, preferred: true, verificationStatus: "VERIFIED", createdBy: owner._id });
    const approvedAdvance = async (owner) => {
      const request = await createFinancialRequest({
        payload: {
          flowType: "C", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: "TRAVEL", priority: "MEDIA",
          issueDate: today, accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: "Trip", description: "Trip",
          businessJustification: "School visit", lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(opex._id), itemDescription: "Trip", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "56", priceIncludesIGV: true }]),
          submit: "true"
        },
        files: {}, user: owner, req
      });
      const approved = (await decideApproval({ id: request._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req })).request;
      assert.equal(approved.status, REQUEST_STATUS.ACCOUNTED);
      return { request: approved, payable: await AccountsPayable.findOne({ request: approved._id }) };
    };
    const snapshotOf = async (request) => (await FinancialRequest.findById(request._id).select(snapshotFields)).rendition.reimbursementBankSnapshot;

    await t.test("a BBVA account number must have the 20 digits the BBVA file needs; other banks are paid by CCI", async () => {
      await assert.rejects(() => createEmployeeReimbursementBankAccount({ payload: { bank: "BBVA", currency: "PEN", accountHolderName: second.name, accountNumber: "001101750100012345", cci: "01117500010001234567", preferred: true }, user: second, req }),
        (error) => error.statusCode === 422 && error.details?.field === "accountNumber" && error.details?.required === 20);
      const interbank = await createEmployeeReimbursementBankAccount({ payload: { bank: "INTERBANK", currency: "PEN", accountHolderName: second.name, accountNumber: "8983001234567", cci: "00389800300123456789" }, user: second, req });
      assert.equal(interbank.bank, "INTERBANK");
      const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20555555571", normalizedIdentifier: "20555555571", legalName: "AR Supplier", name: "AR Supplier", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
      await assert.rejects(() => addSupplierBankAccount({ supplierId: supplier._id, payload: { bank: "BBVA", currency: "PEN", accountType: "CURRENT", accountNumber: "0011017501000123", cci: "01117500010001234567" }, user: accounting, req }),
        (error) => error.details?.field === "accountNumber" && error.details?.required === 20);
    });

    let advance;
    await t.test("verifying the corrected account switches the unpaid advance to it, with an audit entry and a Treasury notice", async () => {
      const original = await verifiedBbva(ruth, "67584675745364532300", "01167584657463213456");
      advance = await approvedAdvance(ruth);
      assert.equal(String((await snapshotOf(advance.request)).profile), String(original._id));
      // The employee corrects the number: a new pending version, the advance unchanged until verified.
      await assert.rejects(() => updateEmployeeReimbursementBankAccount({ accountId: original._id, payload: { accountNumber: "786767676767" }, user: ruth, req }), (error) => error.details?.field === "accountNumber");
      const corrected = await updateEmployeeReimbursementBankAccount({ accountId: original._id, payload: { accountNumber: "78676767676767676767" }, user: ruth, req });
      assert.equal(String((await snapshotOf(advance.request)).profile), String(original._id), "a pending correction does not change it");
      await reviewEmployeeReimbursementBankAccount({ accountId: corrected._id, payload: { result: "VERIFIED" }, user: accounting, req });
      const snapshot = await snapshotOf(advance.request);
      assert.equal(String(snapshot.profile), String(corrected._id));
      assert.equal(snapshot.accountNumber, "78676767676767676767");
      assert.ok(await AuditLog.exists({ entityId: advance.request._id, action: "ADVANCE_DESTINATION_REFRESHED" }));
      const notice = await Notification.findOne({ user: treasury._id, eventKey: `request:${advance.request._id}:destination-refreshed:${corrected._id}` });
      assert.equal(notice?.title, "Advance bank account updated");
      assert.match(notice.message, /ending in 6767/);
      // And the bank file generates with it.
      const result = await generatePaymentBatch({ payableIds: [String(advance.payable._id)], bank: "BBVA", currency: "PEN", paymentDate: today, user: treasury, req });
      files.push(path.join(generatedRoot, "bank-files", result.batch.fileName));
    });

    await t.test("once the advance is in a bank file its destination no longer changes", async () => {
      const inFile = await snapshotOf(advance.request);
      const current = await EmployeeReimbursementBankAccount.findOne({ user: ruth._id, active: true, preferred: true });
      const changedAgain = await updateEmployeeReimbursementBankAccount({ accountId: current._id, payload: { accountNumber: "11111111111111111111" }, user: ruth, req });
      await reviewEmployeeReimbursementBankAccount({ accountId: changedAgain._id, payload: { result: "VERIFIED" }, user: accounting, req });
      assert.equal(String((await snapshotOf(advance.request)).profile), String(inFile.profile));
      await assert.rejects(() => useCurrentBankAccountForAdvance({ accountsPayableId: advance.payable._id, user: treasury, req }), (error) => error.code === ERROR_CODES.PAYMENT_DESTINATION_LOCKED);
    });

    await t.test("Treasury's 'Use current bank account' fixes an advance captured before the correction", async () => {
      const old = await verifiedBbva(second, "12345678901234567890", "01112345678901234567");
      const { request, payable } = await approvedAdvance(second);
      // A correction verified before this feature existed: the advance kept the old account.
      await EmployeeReimbursementBankAccount.updateOne({ _id: old._id }, { $set: { active: false, preferred: false } });
      const fixed = await verifiedBbva(second, "98765432109876543210", "01198765432109876543");
      assert.equal(String((await snapshotOf(request)).profile), String(old._id));
      const result = await useCurrentBankAccountForAdvance({ accountsPayableId: payable._id, user: treasury, req });
      assert.deepEqual([result.changed, result.bank, result.accountEnding], [true, "BBVA", "3210"]);
      assert.equal(String((await snapshotOf(request)).profile), String(fixed._id));
      assert.equal((await useCurrentBankAccountForAdvance({ accountsPayableId: payable._id, user: treasury, req })).changed, false, "already current");
      const { insertedId } = await AccountsPayable.collection.insertOne({ flowType: "A1", status: "OPEN", currency: "PEN", amount: 10, outstandingAmount: 10, request: request._id });
      await assert.rejects(() => useCurrentBankAccountForAdvance({ accountsPayableId: insertedId, user: treasury, req }), (error) => error.statusCode === 422);
    });
  } finally {
    for (const file of files) await fs.rm(file, { force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
