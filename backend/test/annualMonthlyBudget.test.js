import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import BudgetRule from "../src/models/BudgetRule.js";
import BudgetException from "../src/models/BudgetException.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import User from "../src/models/User.js";
import { createBudgetPlan, adjustBudgetPlan, getBudgetPlan, assertLegacyAllocationChange } from "../src/services/budgetPlanService.js";
import { budgetAllocationRows, budgetOverview } from "../src/services/budgetReportingService.js";
import { previewBudget, reserveBudget, executeBudgetAmount, markBudgetPaidAmount, releaseBudget, deferBudget, executeDeferredBudget } from "../src/services/budgetService.js";
import { distributeAnnualBudget } from "../../shared/budgetPlanning.mjs";

test("annual and monthly budget planning and lifecycle", { timeout: 120000 }, async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_annual_monthly_test_${process.pid}_${Date.now()}`);
  try {
    await Promise.all([BudgetAllocation.init(), BudgetCommitment.init(), BudgetException.init()]);
    const user = await User.create({ name: "Budget Planner", role: "Budget", email: "budget.planner@test.invalid", passwordHash: "unused" });
    const center = await CostCenter.create({ code: "CC-PLAN", name: "Budget test", area: "Finance", budgetMode: "TRANSITIONAL", active: true });
    const expense = await ExpenseType.create({ code: "PLAN-EXP", name: "Supplies", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "603201", active: true });
    const req = { headers: {}, ip: "127.0.0.1" };
    let serial = 0;
    const draft = (year, planningMode = "ANNUAL_MONTHLY", extra = {}) => ({ year, planningMode, costCenter: String(center._id), expenseType: String(expense._id), assignedAmount: "120000", distribution: "EQUAL", reason: "Approved annual plan", ...extra });
    const request = (period, amount, extra = {}) => ({ _id: new mongoose.Types.ObjectId(), requestNumber: `REQ-PLAN-${++serial}`, accountingPeriod: period, issueDate: `${period}-04`, lines: [{ costCenter: center._id, expenseType: expense._id, totalAmount: amount }], ...extra });
    const adjust = (plan, action, amount, extra = {}) => adjustBudgetPlan(plan._id, { operationId: `adjustment-${++serial}`, action, amount, revision: plan.__v, reason: "Approved adjustment", ...extra }, user, req);
    let monthly, yearly;

    await t.test("exact distribution, custom reserve, explicit mode, and input restrictions", async () => {
      assert.equal(distributeAnnualBudget("100.01").reduce((sum, n) => sum + Math.round(n * 100), 0), 10001);
      monthly = await createBudgetPlan(draft("2031"), user, req);
      assert.equal(monthly.months.length, 12);
      assert.equal(monthly.months[8].assignedAmount, 10000);
      assert.equal(monthly.unallocatedAmount, 0);
      yearly = await createBudgetPlan(draft("2032", "ANNUAL_ONLY", { assignedAmount: 12000 }), user, req);
      assert.equal(yearly.months[0].assignedAmount, 0);
      assert.equal(yearly.unallocatedAmount, null);
      const reserve = await createBudgetPlan(draft("2033", "ANNUAL_MONTHLY", { distribution: "CUSTOM", months: Array(12).fill(5000) }), user, req);
      assert.equal(reserve.unallocatedAmount, 60000);
      for (const payload of [draft("2034", "BAD"), draft("2034-01"), draft("2034", "ANNUAL_ONLY", { assignedAmount: -1 }), draft("2034", "ANNUAL_MONTHLY", { distribution: "CUSTOM", months: Array(12).fill(11000) }), draft("2034", "ANNUAL_ONLY", { reason: " " })]) await assert.rejects(() => createBudgetPlan(payload, user, req));
      await assert.rejects(() => createBudgetPlan(draft("2034"), { ...user.toObject(), role: "Solicitor" }, req), (error) => error.statusCode === 403);
      await assert.rejects(() => createBudgetPlan(draft("2031"), user, req), (error) => error.statusCode === 409);
    });

    await t.test("monthly shortage blocks even with annual capacity and a transitional Cost Center", async () => {
      const first = request("2031-09", 8000);
      const commitment = await reserveBudget(first, user._id);
      assert.equal(commitment.lines[0].mode, "ACTIVE");
      assert.equal(commitment.lines[0].budgetMonth, 9);
      const proposal = request("2031-09", 5000);
      const preview = await previewBudget(proposal);
      assert.equal(preview.lines[0].annualAvailable, 112000);
      assert.equal(preview.lines[0].monthlyAvailable, 2000);
      assert.equal(preview.lines[0].monthlyProjected, -3000);
      await assert.rejects(() => reserveBudget(proposal, user._id), (error) => error.code === "INSUFFICIENT_BUDGET" && error.details.monthlyAvailable === 2000);
      assert.equal((await getBudgetPlan(monthly._id)).committedAmount, 8000);
      await executeBudgetAmount(first, user._id, 3000);
      await markBudgetPaidAmount(first, user._id, 2000);
      let saved = await getBudgetPlan(monthly._id);
      assert.equal(saved.committedAmount, 5000);
      assert.equal(saved.executedAmount, 3000);
      assert.equal(saved.paidAmount, 2000);
      assert.equal(saved.months[8].availableAmount, 2000);
      await releaseBudget(first, user._id, "Cancel remaining purchase");
      await releaseBudget(first, user._id, "Repeat cancellation");
      saved = await getBudgetPlan(monthly._id);
      assert.equal(saved.committedAmount, 0);
      assert.equal(saved.executedAmount, 3000);
      assert.equal(saved.months[8].availableAmount, 7000);
      assert.equal(saved.availableAmount, 117000);
    });

    await t.test("annual-only permits any month, blocks annual exhaustion, and preserves reservation month", async () => {
      const first = request("2032-01", 11000);
      await reserveBudget(first, user._id);
      await assert.rejects(() => reserveBudget(request("2032-12", 2000), user._id), /insufficient budget/);
      first.accountingPeriod = "2032-02";
      await executeBudgetAmount(first, user._id, 11000);
      await markBudgetPaidAmount(first, user._id, 11000);
      const saved = await getBudgetPlan(yearly._id);
      assert.equal(saved.availableAmount, 1000);
      assert.equal(saved.months[0].paidAmount, 11000);
      assert.equal(saved.months[1].paidAmount, 0);
      const rows = await budgetAllocationRows({ period: "2032-01" });
      assert.equal(rows[0].assignedAmount, null);
      assert.equal(rows[0].executedAmount, 11000);
    });

    await t.test("competing reservations cannot overspend a monthly or annual cap", async () => {
      const outcomes = await Promise.allSettled([reserveBudget(request("2031-10", 7000), user._id), reserveBudget(request("2031-10", 7000), user._id)]);
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      const saved = await getBudgetPlan(monthly._id);
      assert.equal(saved.months[9].committedAmount, 7000);
      assert.equal(saved.committedAmount, 7000);
    });

    await t.test("multi-line shortages and failed commitment saves roll back both counters", async () => {
      const proposal = request("2031-11", 0, { lines: [
        { costCenter: center._id, expenseType: expense._id, budgetItem: "a", totalAmount: 6000 },
        { costCenter: center._id, expenseType: expense._id, budgetItem: "b", totalAmount: 6000 }
      ] });
      const preview = await previewBudget(proposal);
      assert.equal(preview.totalAvailable, 10000);
      assert.equal(preview.projectedBalance, -2000);
      await assert.rejects(() => reserveBudget(proposal, user._id));
      const originalCreate = BudgetCommitment.create;
      BudgetCommitment.create = async () => { throw new Error("Simulated persistence failure"); };
      try { await assert.rejects(() => reserveBudget(request("2031-11", 2000), user._id), /Simulated/); }
      finally { BudgetCommitment.create = originalCreate; }
      assert.equal((await getBudgetPlan(monthly._id)).months[10].committedAmount, 0);
    });

    await t.test("transfers, reserve allocations and increases retain usage and audit history", async () => {
      let saved = await getBudgetPlan(monthly._id);
      await assert.rejects(() => adjust(saved, "TRANSFER", 8000, { fromMonth: 9, toMonth: 10 }), /insufficient uncommitted/);
      saved = await adjust(saved, "TRANSFER", 2000, { fromMonth: 9, toMonth: 10 });
      assert.equal(saved.assignedAmount, 120000);
      assert.equal(saved.months[8].assignedAmount, 8000);
      assert.equal(saved.months[9].assignedAmount, 12000);
      assert.equal(saved.months[8].executedAmount, 3000);
      saved = await adjust(saved, "INCREASE", 5000);
      assert.equal(saved.unallocatedAmount, 5000);
      saved = await adjust(saved, "ALLOCATE_RESERVE", 3000, { toMonth: 11 });
      assert.equal(saved.unallocatedAmount, 2000);
      assert.equal(saved.months[10].assignedAmount, 13000);
      assert.equal(saved.adjustments.at(-1).reason, "Approved adjustment");
      assert.equal(saved.adjustments.at(-1).actorName, user.name);
      const duplicate = saved.adjustments.at(-1);
      const repeated = await adjustBudgetPlan(saved._id, { operationId: duplicate.operationId }, user, req);
      assert.equal(repeated.months[10].assignedAmount, 13000);
      await assert.rejects(() => adjustBudgetPlan(saved._id, { operationId: "stale-adjustment", action: "INCREASE", revision: 0, amount: 100, reason: "Stale" }, user, req), (error) => error.statusCode === 409);
      await assert.rejects(() => adjust(saved, "ALLOCATE_RESERVE", 3000, { toMonth: 12 }), /reserve is insufficient/);
      const attempts = await Promise.allSettled([adjust(saved, "TRANSFER", 1000, { fromMonth: 1, toMonth: 2 }), adjust(saved, "TRANSFER", 1000, { fromMonth: 1, toMonth: 3 })]);
      assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
      await assert.rejects(() => assertLegacyAllocationChange({ assignedAmount: 999999 }, saved), /Manage this linked/);
    });

    await t.test("zero monthly allocations stay blocked; approved exception remains explicit", async () => {
      const zero = await createBudgetPlan(draft("2034", "ANNUAL_MONTHLY", { distribution: "CUSTOM", months: Array(12).fill(0) }), user, req);
      await assert.rejects(() => reserveBudget(request("2034-01", 100), user._id), /insufficient budget/);
      await BudgetRule.create({ name: "Plan exception", mode: "ACTIVE", costCenter: center._id, expenseType: expense._id, exceptionStrategy: "EXTRAORDINARY_APPROVAL" });
      const proposal = request("2034-01", 100);
      await assert.rejects(() => reserveBudget(proposal, user._id), (error) => error.details.monthlyAvailable === 0);
      const exception = await BudgetException.findOne({ request: proposal._id });
      assert.equal(exception.budgetLimits.monthlyProjected, -100);
      exception.status = "APPROVED"; await exception.save();
      await reserveBudget(proposal, user._id);
      assert.equal((await getBudgetPlan(zero._id)).months[0].committedAmount, 100);
    });

    await t.test("Track C waits for rendition, records both levels, and releases no unreserved money", async () => {
      const plan = await createBudgetPlan(draft("2035"), user, req);
      const advance = request("2035-05", 500);
      await deferBudget(advance, user._id);
      assert.equal((await getBudgetPlan(plan._id)).committedAmount, 0);
      await executeDeferredBudget(advance, user._id);
      await executeDeferredBudget(advance, user._id);
      const saved = await getBudgetPlan(plan._id);
      assert.equal(saved.executedAmount, 500);
      assert.equal(saved.paidAmount, 500);
      assert.equal(saved.months[4].executedAmount, 500);
      const cancelled = request("2035-06", 500);
      await deferBudget(cancelled, user._id);
      await releaseBudget(cancelled, user._id, "Cancelled before rendition");
      assert.equal((await getBudgetPlan(plan._id)).months[5].committedAmount, 0);
      const over = request("2035-07", 20000);
      await deferBudget(over, user._id);
      await assert.rejects(() => executeDeferredBudget(over, user._id));
      assert.equal((await getBudgetPlan(plan._id)).executedAmount, 500);
    });

    await t.test("annual reports count each expenditure once and do not add monthly assignments to annual totals", async () => {
      const plan = await getBudgetPlan(monthly._id);
      const annual = await budgetOverview({ period: "2031", summaryOnly: true });
      assert.equal(annual.totals.assigned, plan.assignedAmount);
      assert.equal(annual.totals.committed, plan.committedAmount);
      assert.equal(annual.totals.executed, plan.executedAmount);
      const september = await budgetOverview({ period: "2031-09", summaryOnly: true });
      assert.equal(september.totals.executed, 3000);
      assert.equal(september.totals.assigned, 8000);
      await assert.rejects(() => budgetOverview({ period: "2031-13" }));
    });

    await t.test("failed execution, payment and release saves restore annual and monthly usage", async () => {
      const plan = await createBudgetPlan(draft("2040"), user, req);
      const purchase = request("2040-04", 6000);
      await reserveBudget(purchase, user._id);
      const usage = (value) => [value.committedAmount, value.executedAmount, value.paidAmount,
        value.months[3].committedAmount, value.months[3].executedAmount, value.months[3].paidAmount];
      const failSave = async (operation) => {
        const before = await getBudgetPlan(plan._id);
        const commitmentBefore = await BudgetCommitment.findOne({ request: purchase._id }).lean();
        const originalSave = BudgetCommitment.prototype.save;
        BudgetCommitment.prototype.save = async () => { throw new Error("Simulated lifecycle save failure"); };
        try { await assert.rejects(operation, /Simulated lifecycle/); }
        finally { BudgetCommitment.prototype.save = originalSave; }
        assert.deepEqual(usage(await getBudgetPlan(plan._id)), usage(before));
        assert.deepEqual(await BudgetCommitment.findOne({ request: purchase._id }).lean(), commitmentBefore);
      };
      await failSave(() => executeBudgetAmount(purchase, user._id, 2000));
      await executeBudgetAmount(purchase, user._id, 2000);
      await failSave(() => markBudgetPaidAmount(purchase, user._id, 1000));
      await markBudgetPaidAmount(purchase, user._id, 1000);
      await failSave(() => releaseBudget(purchase, user._id, "Cancel outstanding balance"));
      await releaseBudget(purchase, user._id, "Cancel outstanding balance");
      assert.deepEqual(usage(await getBudgetPlan(plan._id)), [0, 2000, 1000, 0, 2000, 1000]);
    });

    await t.test("a failed later rendition line restores earlier annual and monthly postings", async () => {
      const plan = await createBudgetPlan(draft("2041"), user, req);
      const advance = request("2041-04", 0, { lines: [
        { costCenter: center._id, expenseType: expense._id, budgetItem: "a", totalAmount: 6000 },
        { costCenter: center._id, expenseType: expense._id, budgetItem: "b", totalAmount: 6000 }
      ] });
      await deferBudget(advance, user._id);
      await assert.rejects(() => executeDeferredBudget(advance, user._id), (error) => error.code === "INSUFFICIENT_BUDGET");
      const saved = await getBudgetPlan(plan._id);
      assert.equal(saved.executedAmount, 0);
      assert.equal(saved.paidAmount, 0);
      assert.equal(saved.months[3].executedAmount, 0);
      assert.equal(saved.months[3].paidAmount, 0);
      assert.equal((await BudgetCommitment.findOne({ request: advance._id })).status, "DEFERRED");
    });

    await t.test("competing requests in different months share one annual-only limit", async () => {
      const plan = await createBudgetPlan(draft("2042", "ANNUAL_ONLY", { assignedAmount: 10000 }), user, req);
      const outcomes = await Promise.allSettled([
        reserveBudget(request("2042-01", 7000), user._id), reserveBudget(request("2042-12", 7000), user._id)
      ]);
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      const saved = await getBudgetPlan(plan._id);
      assert.equal(saved.committedAmount, 7000);
      assert.equal(saved.months.reduce((total, bucket) => total + bucket.committedAmount, 0), 7000);
      assert.equal(saved.availableAmount, 3000);
    });

    await t.test("legacy allocations remain valid and cannot overlap a new annual plan", async () => {
      const allocation = await BudgetAllocation.create({ period: "2036-01", costCenter: center._id, expenseType: expense._id, assignedAmount: 1000 });
      await assert.rejects(() => createBudgetPlan(draft("2036"), user, req), (error) => error.statusCode === 409);
      const first = await reserveBudget(request("2036-01", 100), user._id);
      assert.equal(String(first.lines[0].allocation), String(allocation._id));
      assert.equal(first.lines[0].budgetMonth, undefined);
      await assert.rejects(() => assertLegacyAllocationChange({ period: "2031-01", costCenter: center._id, expenseType: expense._id, project: "" }), /linked annual budget/);
      assert.equal((await budgetOverview({ period: "2036", summaryOnly: true })).totals.assigned, 1000);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
