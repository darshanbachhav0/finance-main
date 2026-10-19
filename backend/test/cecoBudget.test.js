import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountingMapping from "../src/models/AccountingMapping.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import JournalEntry from "../src/models/JournalEntry.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { superAdminMayCall } from "../src/middleware/auth.js";
import { decideApproval } from "../src/services/approvalService.js";
import { verifyBankFile } from "../src/services/bankFileVerificationService.js";
import { adjustBudgetPlan, createBudgetPlan } from "../src/services/budgetPlanService.js";
import { createEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { reviewRendition, submitRendition } from "../src/services/renditionService.js";
import { createFinancialRequest } from "../src/services/requestService.js";
import { generatedRoot, tempUploadDir } from "../src/services/storageService.js";
import { confirmTreasuryPayable, generatePaymentBatch } from "../src/services/treasuryService.js";
import { BUDGET_PLAN_MANAGERS, ERROR_CODES, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";
import { splitAnnualBudget } from "../../shared/budgetPlanning.mjs";
import { installBbvaTestConfiguration, upcomingPaymentDate } from "./bbvaFixtures.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const period = "2026-09";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const sum = (values) => Math.round(values.reduce((total, value) => total + value * 100, 0)) / 100;

test("an equal monthly split never goes below what a month already used", () => {
  assert.deepEqual(splitAnnualBudget("1200"), Array(12).fill(100));
  const used = splitAnnualBudget("1000", { floors: [500] });
  assert.equal(used[0], 500, "January keeps what it used");
  assert.equal(sum(used), 1000, "the months add up to the annual budget");
  const rest = splitAnnualBudget("12000", { floors: [800, 900, 100], fromMonth: 10 });
  assert.deepEqual(rest, [800, 900, 100, 0, 0, 0, 0, 0, 0, 3400, 3400, 3400], "from October: earlier months keep what they used, the rest is split");
  assert.equal(sum(splitAnnualBudget("100.01")), 100.01, "cents are not lost");
  assert.throws(() => splitAnnualBudget("100", { floors: [60, 60] }), /already used more than the annual budget/);
});

test("Admin, Treasury and the Super Admin manage CECO budgets", () => {
  assert.deepEqual([...BUDGET_PLAN_MANAGERS], [ROLES.ADMIN, ROLES.TREASURY, ROLES.SUPER_ADMIN]);
  assert.equal(superAdminMayCall("POST", "/api/budget/plans"), true);
  assert.equal(superAdminMayCall("POST", "/api/budget/plans/abc/adjustments"), true);
  assert.equal(superAdminMayCall("POST", "/api/budget/plan-changes/abc/cancel"), true, "the route still allows only plan managers");
  assert.equal(superAdminMayCall("POST", "/api/budget/exceptions/abc/decision"), false, "budget exceptions stay with Treasury and Management");
  assert.equal(superAdminMayCall("POST", "/api/budget/requests/abc/commit"), false);
});

test("CECO budgets: each advance is charged to its own CECO, with or without an annual plan", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_ceco_budget_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
  const files = [];
  try {
    await Promise.all([FinancialRequest.init(), AccountsPayable.init(), JournalEntry.init(), Notification.init(), BudgetAllocation.init()]);
    await installBbvaTestConfiguration();
    // "Open" has no annual plan (TRANSITIONAL); "Planned" has a 2026 plan of exactly S/ 56.
    const open = await CostCenter.create({ code: "CB-OPEN", name: "No plan yet", area: "Operations", active: true });
    const planned = await CostCenter.create({ code: "CB-PLAN", name: "Planned", area: "Admissions", active: true });
    const other = await CostCenter.create({ code: "CB-OTHER", name: "Someone else's", area: "Library", active: true });
    const opex = await ExpenseType.create({ code: "CB-OPEX", name: "Travel expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, active: true });
    const director = await User.create({ name: "CB Director", email: "cb.director@test.local", passwordHash: "unused", role: ROLES.AREA_DIRECTOR, approvalLevel: "AREA_DIRECTOR", approvalAreas: ["*"], area: "Operations" });
    const owner = await User.create({ name: "CB Employee", dni: "44556622", employeeCode: "UMA-CB-1", email: "cb.owner@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: open._id, authorizedCostCenters: [open._id, planned._id, other._id], jefe: director._id });
    const accounting = await User.create({ name: "CB Accounting", email: "cb.accounting@test.local", passwordHash: "unused", role: ROLES.ACCOUNTING, area: "Finance" });
    const treasury = await User.create({ name: "CB Treasury", email: "cb.treasury@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Finance" });
    const superAdmin = await User.create({ name: "CB Super Admin", email: "cb.super@test.local", passwordHash: "unused", role: ROLES.SUPER_ADMIN, area: "IT" });
    const solicitor = await User.create({ name: "CB Other", email: "cb.other@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    await AccountingPeriod.create({ period, status: "OPEN" });
    for (const [purpose, accountNumber, bank] of [["ACCOUNTS_PAYABLE", "421201"], ["IGV", "401111"], ["BANK", "104101", "BCP"], ["BANK", "104102", "BBVA"], ["ADVANCE_TRANSIT", "141301"], ["RETURN_RECEIVABLE", "101199"]]) {
      await AccountingMapping.create({ code: `CB-${purpose}-${bank || "ALL"}`, name: purpose, purpose, requestType: "*", expenseNature: "*", bank: bank || "*", currency: "*", accountNumber, active: true });
    }
    await ApprovalRule.create({ name: "CB director", approvalLevel: "AREA_DIRECTOR", role: ROLES.AREA_DIRECTOR, area: "*", amountFrom: 0, requestType: "*", flowType: "*", required: true, sequence: 1, slaHours: 24, active: true });
    const bank = await createEmployeeReimbursementBankAccount({ payload: { bank: "BCP", currency: "PEN", accountHolderName: owner.name, accountNumber: "1941000000022", cci: "00219410000000000022", preferred: true }, user: owner, req });
    await reviewEmployeeReimbursementBankAccount({ accountId: bank._id, payload: { result: "VERIFIED" }, user: accounting, req });
    const writeTemp = async (name) => {
      await fs.mkdir(tempUploadDir, { recursive: true });
      const filePath = path.join(tempUploadDir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
      await fs.writeFile(filePath, JPEG);
      files.push(filePath);
      return { path: filePath, filename: path.basename(filePath), originalname: name, mimetype: "image/jpeg", size: JPEG.length };
    };
    const paidAdvance = async (center, number) => {
      const created = await createFinancialRequest({
        payload: { flowType: "C", requestType: REQUEST_TYPE.ENTREGA_RENDIR, expenseNature: "TRAVEL", priority: "MEDIA", issueDate: "2026-09-10", accountingPeriod: period, currency: "PEN", requesterCostCenter: String(center._id), title: `Trip ${number}`, description: `Trip ${number}`, businessJustification: "School visit",
          lines: JSON.stringify([{ costCenter: String(center._id), expenseType: String(opex._id), itemDescription: "Trip", quantity: "1", unitOfMeasure: "UNIT", unitPrice: "56", priceIncludesIGV: true }]), submit: "true" },
        files: {}, user: owner, req
      });
      await decideApproval({ id: created._id, action: "APPROVE", comments: "Approved", forward: false, user: director, req });
      const payable = await AccountsPayable.findOne({ request: created._id });
      const batch = await generatePaymentBatch({ payableIds: [String(payable._id)], bank: "BBVA", currency: "PEN", paymentDate: upcomingPaymentDate(), user: treasury, req });
      files.push(path.join(generatedRoot, "bank-files", batch.batch.fileName));
      await verifyBankFile({ batchId: batch.batch._id, user: accounting, req });
      await confirmTreasuryPayable({ accountsPayableId: payable._id, payload: { operationNumber: `CB-OP-${number}`, paidAt: "2026-09-18", confirmedAmount: 56 }, user: treasury, req });
      return created;
    };
    const rendition = async (request, center, { costCenter = center } = {}) => submitRendition({
      requestId: request._id, user: owner, req, files: { rendition: [await writeTemp("boleta.jpg")], returnReceipt: [await writeTemp("voucher.jpg")] },
      payload: { receiptLines: JSON.stringify([{ date: "2026-09-19", documentType: "BOLETA", description: "Lunch", amount: 50, fileIndex: 0 }]), lines: JSON.stringify([{ costCenter: String(costCenter._id), netAmount: 50, igvAmount: 0, totalAmount: 50 }]), amountReturned: "6", beneficiaryAcknowledged: "true" }
    });

    await t.test("plans are created and spread by Admin, Treasury or the Super Admin, never by a requester", async () => {
      const draft = { year: "2026", planningMode: "ANNUAL_ONLY", costCenter: String(planned._id), assignedAmount: "56", reason: "2026 budget" };
      await assert.rejects(() => createBudgetPlan(draft, solicitor, req), (error) => error.statusCode === 403);
      const plan = await createBudgetPlan(draft, superAdmin, req);
      assert.equal(plan.assignedAmount, 56);
      assert.equal(plan.priorUnplannedAmount, 0);
    });

    let openAdvance;
    await t.test("an advance from a CECO without a plan only records its budget, and its rendition is not blocked", async () => {
      openAdvance = await paidAdvance(open, 1);
      assert.equal((await BudgetCommitment.findOne({ request: openAdvance._id })).status, "NO_BUDGET");
      await assert.rejects(() => rendition(openAdvance, open, { costCenter: other }), (error) => error.code === ERROR_CODES.INVALID_COST_CENTER_LINE && /advance's own CECO/.test(error.message), "spending goes to the advance's own CECO");
      assert.equal((await rendition(openAdvance, open)).rendition.status, "SUBMITTED");
    });

    await t.test("a plan can start mid-year when the earlier spending was never budget-controlled", async () => {
      const plan = await createBudgetPlan({ year: "2026", planningMode: "ANNUAL_MONTHLY", distribution: "CUSTOM", months: ["1200", ...Array(11).fill("0")], costCenter: String(open._id), assignedAmount: "1200", reason: "Budget from now on" }, treasury, req);
      assert.equal(plan.priorUnplannedAmount, 56, "the page says S/ 56 was spent before the plan");
      // Treasury spreads it equally; the Super Admin then sets an unequal split.
      const equal = await adjustBudgetPlan(plan._id, { operationId: "cb-equal-split", action: "REDISTRIBUTE", months: splitAnnualBudget("1200").map(String), reason: "Equal months", revision: plan.__v }, treasury, req);
      assert.deepEqual(equal.months.map((bucket) => bucket.assignedAmount), Array(12).fill(100));
      const unequal = await adjustBudgetPlan(plan._id, { operationId: "cb-custom-split", action: "REDISTRIBUTE", months: ["300", "100", "100", "100", "100", "100", "100", "100", "100", "100", "0", "0"], reason: "More in January", revision: equal.__v }, superAdmin, req);
      assert.deepEqual(unequal.months.slice(0, 2).concat(unequal.months.slice(10)).map((bucket) => bucket.assignedAmount), [300, 100, 0, 0]);
      await assert.rejects(() => adjustBudgetPlan(plan._id, { operationId: "cb-solicitor", action: "REDISTRIBUTE", months: Array(12).fill("100"), reason: "No", revision: unequal.__v }, solicitor, req), (error) => error.statusCode === 403);
      // Budget-controlled usage in the year still blocks a new plan, as before.
      await BudgetCommitment.collection.insertOne({ request: new mongoose.Types.ObjectId(), period: "2026-03", status: "COMMITTED", totalAmount: 10, lines: [{ costCenter: other._id, project: "", amount: 10, mode: "ACTIVE" }] });
      await assert.rejects(() => createBudgetPlan({ year: "2026", planningMode: "ANNUAL_ONLY", costCenter: String(other._id), assignedAmount: "500", reason: "Late" }, treasury, req), (error) => error.statusCode === 409);
    });

    await t.test("Accounting approves the rendition of the advance approved before the plan existed", async () => {
      const approved = await reviewRendition({ requestId: openAdvance._id, action: "APPROVE", comments: "OK", user: accounting, req });
      assert.equal(approved.request.rendition.status, "VALIDATED", "no 'insufficient budget' for a CECO that had no plan");
    });

    await t.test("an advance on a planned CECO counts its own reservation at rendition", async () => {
      const advance = await paidAdvance(planned, 2);
      assert.equal((await BudgetCommitment.findOne({ request: advance._id })).status, "COMMITTED");
      const plan = await BudgetAllocation.findOne({ costCenter: planned._id, period: "2026" });
      assert.equal(plan.assignedAmount - plan.committedAmount - plan.executedAmount, 0, "the S/ 56 plan is fully reserved by the advance");
      await rendition(advance, planned);
      const approved = await reviewRendition({ requestId: advance._id, action: "APPROVE", comments: "OK", user: accounting, req });
      assert.equal(approved.request.rendition.status, "VALIDATED", "the S/ 50 spent fits in what the advance itself reserved");
    });
  } finally {
    await Promise.all(files.map((file) => fs.rm(file, { force: true })));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
