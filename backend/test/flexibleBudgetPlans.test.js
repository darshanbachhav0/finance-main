import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import BudgetAllocation from "../src/models/BudgetAllocation.js";
import BudgetPlanChange from "../src/models/BudgetPlanChange.js";
import CostCenter from "../src/models/CostCenter.js";
import FinanceConfiguration from "../src/models/FinanceConfiguration.js";
import User from "../src/models/User.js";
import { adjustBudgetPlan, createBudgetPlan, getBudgetPlan, lastEndedMonth } from "../src/services/budgetPlanService.js";
import { cancelBudgetPlanChange, decideBudgetPlanChange, listBudgetPlanChanges } from "../src/services/budgetPlanChangeService.js";
import { rollForwardUnusedBudget } from "../src/services/budgetRollForwardService.js";

test("flexible budget plans: Admin edits months, reserve, annual amount and mode; roll-forward; approval threshold", { timeout: 120000 }, async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_flexible_budget_${process.pid}_${Date.now()}`);
  try {
    await BudgetAllocation.init();
    const admin = await User.create({ name: "Plan Admin", role: "Admin", email: "flex.admin@test.invalid", passwordHash: "unused" });
    const budget = await User.create({ name: "Budget Officer", role: "Budget", email: "flex.budget@test.invalid", passwordHash: "unused" });
    const management = await User.create({ name: "Management", role: "Management", email: "flex.management@test.invalid", passwordHash: "unused" });
    const req = { headers: {}, ip: "127.0.0.1" };
    let serial = 0;
    let centerSerial = 0;
    async function plan({ year = "2031", planningMode = "ANNUAL_MONTHLY", annual = "12000" } = {}) {
      const center = await CostCenter.create({ code: `CC-FLEX-${++centerSerial}`, name: "Flexible budget", area: "Finance", budgetMode: "ACTIVE", active: true });
      return createBudgetPlan({ year, planningMode, costCenter: String(center._id), assignedAmount: annual, distribution: "EQUAL", reason: "Approved plan" }, budget, req);
    }
    const fresh = (value) => getBudgetPlan(value._id);
    const change = async (value, action, extra = {}, user = admin) => adjustBudgetPlan(value._id, { operationId: `flex-change-${++serial}`, action, revision: (await BudgetAllocation.findById(value._id)).__v, reason: "Approved reallocation", ...extra }, user, req);
    const use = (value, month, committed, executed = 0) => BudgetAllocation.updateOne({ _id: value._id }, { $inc: { committedAmount: committed, executedAmount: executed, [`months.${month - 1}.committedAmount`]: committed, [`months.${month - 1}.executedAmount`]: executed } });
    const assigned = (value) => value.months.map((bucket) => bucket.assignedAmount);

    await t.test("only Admin changes an existing plan; Budget still creates plans", async () => {
      const value = await plan();
      await assert.rejects(() => change(value, "INCREASE", { amount: 100 }, budget), (error) => error.statusCode === 403);
      await assert.rejects(() => change(value, "INCREASE", { amount: 100 }, management), (error) => error.statusCode === 403);
      assert.equal((await change(value, "INCREASE", { amount: 100 })).assignedAmount, 12100);
    });

    await t.test("the monthly grid is edited in one audited redistribution that respects committed and spent money", async () => {
      const value = await plan();
      await use(value, 3, 600, 200);
      const months = assigned(value);
      months[0] = 500; months[2] = 1500; months[11] = 1000; // 500 out of Jan, 500 into Mar, Dec unchanged
      const saved = await change(value, "REDISTRIBUTE", { months });
      assert.deepEqual(assigned(saved).slice(0, 3), [500, 1000, 1500]);
      const entry = saved.adjustments.at(-1);
      assert.equal(entry.action, "REDISTRIBUTE");
      assert.equal(entry.amount, 500);
      assert.deepEqual(entry.monthChanges.map(({ month, before, after }) => [month, before, after]), [[1, 1000, 500], [3, 1000, 1500]]);
      assert.ok(await AuditLog.exists({ entityId: value._id, action: "REDISTRIBUTE" }));
      // March has 800 committed + spent: it can go down to 800 but never below.
      const below = assigned(saved); below[2] = 799; below[0] = 1201;
      await assert.rejects(() => change(value, "REDISTRIBUTE", { months: below }), /March cannot go below what it has already committed and spent \(PEN 800.00\)/);
      const over = assigned(saved); over[5] = 1000.01;
      await assert.rejects(() => change(value, "REDISTRIBUTE", { months: over }), /more than the annual budget/);
      await assert.rejects(() => change(value, "REDISTRIBUTE", { months: assigned(saved) }), /No month changed/);
      await assert.rejects(() => change(value, "REDISTRIBUTE", { months: assigned(saved).slice(0, 11) }), /all twelve months/);
    });

    await t.test("unused month money returns to the reserve; the annual amount decreases only from the reserve or unused budget", async () => {
      const value = await plan();
      await use(value, 1, 900);
      await assert.rejects(() => change(value, "RELEASE_TO_RESERVE", { amount: 200, fromMonth: 1 }), /January has only PEN 100.00 unused/);
      const released = await change(value, "RELEASE_TO_RESERVE", { amount: 100, fromMonth: 2 });
      assert.equal(released.unallocatedAmount, 100);
      await assert.rejects(() => change(value, "DECREASE", { amount: 150 }), /Only the annual reserve \(PEN 100.00\)/);
      const decreased = await change(value, "DECREASE", { amount: 100 });
      assert.equal(decreased.assignedAmount, 11900);
      assert.equal(decreased.unallocatedAmount, 0);
      const yearly = await plan({ planningMode: "ANNUAL_ONLY" });
      await use(yearly, 4, 11000);
      await assert.rejects(() => change(yearly, "DECREASE", { amount: 1001 }), /Only PEN 1000.00 of the annual budget is unused/);
      assert.equal((await change(yearly, "DECREASE", { amount: 1000 })).assignedAmount, 11000);
    });

    await t.test("the planning mode switches both ways without uncovering used money", async () => {
      const value = await plan({ planningMode: "ANNUAL_ONLY" });
      await use(value, 6, 5000);
      await assert.rejects(() => change(value, "MODE_CHANGE", { planningMode: "ANNUAL_MONTHLY", distribution: "EQUAL" }), /June cannot go below.*keep current usage/);
      const monthly = await change(value, "MODE_CHANGE", { planningMode: "ANNUAL_MONTHLY", distribution: "USAGE" });
      assert.equal(monthly.planningMode, "ANNUAL_MONTHLY");
      assert.equal(monthly.months[5].assignedAmount, 5000);
      assert.equal(monthly.unallocatedAmount, 7000);
      await change(monthly, "SETTINGS", { rollForward: true });
      const yearly = await change(monthly, "MODE_CHANGE", { planningMode: "ANNUAL_ONLY" });
      assert.equal(yearly.planningMode, "ANNUAL_ONLY");
      assert.ok(assigned(yearly).every((amount) => amount === 0));
      assert.equal(yearly.rollForward.enabled, false, "roll-forward needs monthly control");
      const entry = yearly.adjustments.at(-1);
      assert.equal(entry.modeBefore, "ANNUAL_MONTHLY");
      assert.equal(entry.modeAfter, "ANNUAL_ONLY");
      await assert.rejects(() => change(yearly, "TRANSFER", { amount: 1, fromMonth: 1, toMonth: 2 }), /needs annual \+ monthly budget control/);
    });

    await t.test("Admin may edit months of a closed accounting period; the change records which ones", async () => {
      const value = await plan({ year: "2032" });
      await AccountingPeriod.create({ period: "2032-02", status: "CLOSED", closedAt: new Date(), closedBy: admin._id });
      const saved = await change(value, "TRANSFER", { amount: 300, fromMonth: 2, toMonth: 5 });
      assert.deepEqual(saved.adjustments.at(-1).closedMonths, [2]);
      assert.deepEqual(saved.closedMonths, [2]);
      assert.equal(saved.months[1].assignedAmount, 700);
    });

    await t.test("a stale editor is refused instead of overwriting another change", async () => {
      const value = await plan();
      const loaded = await BudgetAllocation.findById(value._id);
      await change(value, "TRANSFER", { amount: 10, fromMonth: 1, toMonth: 2 });
      await assert.rejects(() => adjustBudgetPlan(value._id, { operationId: "flex-stale-0001", action: "TRANSFER", amount: 10, fromMonth: 3, toMonth: 4, revision: loaded.__v, reason: "Stale" }, admin, req), (error) => error.statusCode === 409);
    });

    await t.test("roll-forward moves each ended month's unused budget to the next month, once, never December", async () => {
      const value = await plan({ year: "2033" });
      const before = new Date("2033-04-15T12:00:00Z");
      assert.equal(lastEndedMonth("2033", before), 3);
      // Turned on mid-April: January-March are already closed and keep their balances.
      await adjustBudgetPlan(value._id, { operationId: "flex-roll-on-01", action: "SETTINGS", rollForward: true, revision: (await BudgetAllocation.findById(value._id)).__v, reason: "Roll unused budget forward" }, admin, req);
      assert.equal((await BudgetAllocation.findById(value._id)).rollForward.lastRolledMonth, Math.min(lastEndedMonth("2033"), 11));
      await BudgetAllocation.updateOne({ _id: value._id }, { $set: { "rollForward.lastRolledMonth": 3 } });
      await use(value, 4, 400);
      // Early June: April and May have ended.
      const summary = await rollForwardUnusedBudget({ now: new Date("2033-06-02T12:00:00Z") });
      assert.ok(summary.moves >= 2);
      let rolled = await fresh(value);
      assert.deepEqual(assigned(rolled).slice(3, 6), [400, 0, 2600], "April keeps its 400 used; 600 + 1000 + 1000 reach June");
      assert.equal(rolled.rollForward.lastRolledMonth, 5);
      assert.deepEqual(rolled.adjustments.filter((entry) => entry.action === "ROLL_FORWARD").map((entry) => [entry.fromMonth, entry.toMonth, entry.amount]), [[4, 5, 600], [5, 6, 1600]]);
      await rollForwardUnusedBudget({ now: new Date("2033-06-20T12:00:00Z") });
      assert.deepEqual(assigned(await fresh(value)), assigned(rolled), "running again in the same month changes nothing");
      // After the year: everything rolls up to December, and December never rolls out.
      await rollForwardUnusedBudget({ now: new Date("2034-02-10T12:00:00Z") });
      rolled = await fresh(value);
      assert.equal(rolled.rollForward.lastRolledMonth, 11);
      assert.equal(rolled.months[11].assignedAmount, 12000 - 3000 - 400, "Jan-Mar untouched, April's 400 used, the rest ends in December");
      // Switched off: nothing moves.
      const off = await plan({ year: "2033" });
      await rollForwardUnusedBudget({ now: new Date("2034-02-10T12:00:00Z") });
      assert.deepEqual(assigned(await fresh(off)), assigned(off));
    });

    await t.test("above the approval threshold a change waits for Management, which approves (re-checked) or rejects; Admin may withdraw", async () => {
      await FinanceConfiguration.create({ key: "BUDGET_CHANGE_APPROVAL_THRESHOLD", numericValue: 1000, currency: "PEN", behavior: "BLOCK", effectiveFrom: new Date("2020-01-01") });
      const value = await plan({ year: "2035" });
      // At or under the threshold: applied at once.
      assert.equal((await change(value, "TRANSFER", { amount: 1000, fromMonth: 1, toMonth: 2 })).months[1].assignedAmount, 2000);
      const submitted = await change(value, "TRANSFER", { amount: 1000.01, fromMonth: 2, toMonth: 4 });
      assert.equal(submitted.submittedForApproval.status, "PENDING");
      assert.equal(submitted.months[1].assignedAmount, 2000, "nothing moves before approval");
      assert.equal(submitted.pendingChanges.length, 1);
      const pending = submitted.submittedForApproval;
      await assert.rejects(() => decideBudgetPlanChange(pending._id, { decision: "APPROVE", comments: "ok" }, admin, req), (error) => error.statusCode === 403);
      await assert.rejects(() => decideBudgetPlanChange(pending._id, { decision: "APPROVE" }, management, req), /comments are required/);
      // Meanwhile February got committed: the approval re-checks and refuses, the change stays pending.
      await use(value, 2, 1000);
      await assert.rejects(() => decideBudgetPlanChange(pending._id, { decision: "APPROVE", comments: "Fine" }, management, req), /February has only PEN 1000.00 unused/);
      assert.equal((await BudgetPlanChange.findById(pending._id)).status, "PENDING");
      await BudgetAllocation.updateOne({ _id: value._id }, { $inc: { committedAmount: -1000, "months.1.committedAmount": -1000 } });
      const approved = await decideBudgetPlanChange(pending._id, { decision: "APPROVE", comments: "Approved by Management" }, management, req);
      assert.equal(approved.status, "APPROVED");
      const applied = await fresh(value);
      assert.equal(applied.months[3].assignedAmount, 2000.01);
      const entry = applied.adjustments.at(-1);
      assert.equal(entry.approvedByName, "Management");
      assert.equal(entry.actorName, "Plan Admin");
      await assert.rejects(() => decideBudgetPlanChange(pending._id, { decision: "REJECT", comments: "late" }, management, req), /already decided/);
      // Reject and withdraw.
      const second = (await change(value, "INCREASE", { amount: 5000 })).submittedForApproval;
      const rejected = await decideBudgetPlanChange(second._id, { decision: "REJECT", comments: "No funds" }, management, req);
      assert.equal(rejected.status, "REJECTED");
      assert.equal((await fresh(value)).assignedAmount, 12000);
      const third = (await change(value, "RELEASE_TO_RESERVE", { amount: 1500, fromMonth: 4 })).submittedForApproval;
      assert.equal((await cancelBudgetPlanChange(third._id, admin, req)).status, "CANCELLED");
      const listed = await listBudgetPlanChanges({ status: "PENDING" });
      assert.equal(listed.data.length, 0);
      // Structure-only changes never need approval.
      assert.equal((await change(value, "SETTINGS", { rollForward: true })).rollForward.enabled, true);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
