import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import BudgetException from "../src/models/BudgetException.js";
import BudgetRule from "../src/models/BudgetRule.js";
import CostCenter from "../src/models/CostCenter.js";
import User from "../src/models/User.js";
import {
  reserveBudget,
  assertBudgetBeforePosting,
  executeBudgetAmount,
  markBudgetPaidAmount,
  releaseBudget
} from "../src/services/budgetService.js";
import { previewBudget } from "../src/services/budgetService.js";
import { BUDGET_STATUS } from "../src/utils/constants.js";

test("Budget Phase 1 (TRANSITIONAL) is genuinely informational and Phase 2 (ACTIVE) genuinely blocks", async (t) => {
  const database = `erp_budget_phase_mode_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  try {
    await Promise.all([BudgetCommitment.init(), BudgetException.init()]);
    const budget = await User.create({ name: "Budget Officer", email: "budget-phase@test.local", role: "Budget", passwordHash: "unused" });
    const make = (center, amount) => ({
      _id: new mongoose.Types.ObjectId(),
      requestNumber: `R-${new mongoose.Types.ObjectId()}`,
      accountingPeriod: "2026-09",
      issueDate: "2026-09-14",
      lines: [{ costCenter: center._id, expenseType: new mongoose.Types.ObjectId(), totalAmount: amount }]
    });

    await t.test("Phase 1: an over-budget request is recorded informationally and never blocks the workflow", async () => {
      const center = await CostCenter.create({ code: "PHASE1-CC", name: "Phase 1", area: "Finance", annualBudget: 100, budgetMode: "TRANSITIONAL", active: true });
      const request = make(center, 500);

      const commitment = await reserveBudget(request, budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.NO_BUDGET, "no blocking hold is placed under Phase 1");
      assert.equal(commitment.lines[0].mode, "TRANSITIONAL");
      assert.equal(commitment.totalAmount, 500, "the requested amount is still recorded for informational reporting");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 0, "the shared pooled balance is never touched");

      await assert.doesNotReject(() => assertBudgetBeforePosting(request, { amount: 500 }), "insufficient budget must not block accounting/posting in Phase 1");

      await executeBudgetAmount(request, budget._id, 300);
      await markBudgetPaidAmount(request, budget._id, 200);
      const executed = await BudgetCommitment.findOne({ request: request._id });
      assert.equal(executed.executedAmount, 300, "execution is still tracked informationally");
      assert.equal(executed.paidAmount, 200, "payment is still tracked informationally");
      assert.equal((await CostCenter.findById(center._id)).executedAmount, 0, "the shared pooled balance is still never touched");

      const cancelled = make(center, 400);
      await reserveBudget(cancelled, budget._id);
      await releaseBudget(cancelled, budget._id, "Cancelled before posting");
      assert.equal((await BudgetCommitment.findOne({ request: cancelled._id })).status, BUDGET_STATUS.RELEASED, "cancellation/rollback still transitions cleanly");
    });

    await t.test("an explicitly ACTIVE zero budget cannot silently become informational", async () => {
      const center = await CostCenter.create({ code: "ZERO-ACTIVE", name: "Zero active budget", area: "Finance", annualBudget: 0, budgetMode: "ACTIVE", active: true });
      const request = make(center, 10);
      assert.equal((await previewBudget(request)).status, "INSUFFICIENT");
      // No BudgetRule is configured, so the default REJECT strategy applies: a hard
      // rejection with no exception, not a silent pass-through to informational mode.
      await assert.rejects(reserveBudget(request, budget._id), error => error.code === "INSUFFICIENT_BUDGET" && error.details?.hardReject === true);
      assert.equal(await BudgetException.exists({ request: request._id }), null);
      assert.equal(await BudgetCommitment.countDocuments({ request: request._id }), 0);
    });
    await t.test("Phase 2: the same over-budget amount is blocked and a within-budget amount commits real funds", async () => {
      const center = await CostCenter.create({ code: "PHASE2-CC", name: "Phase 2", area: "Finance", annualBudget: 100, budgetMode: "ACTIVE", active: true });
      const overBudget = make(center, 500);
      // Default (unconfigured) REJECT strategy: hard rejection, no exception prepared.
      await assert.rejects(() => reserveBudget(overBudget, budget._id), (error) => error.code === "INSUFFICIENT_BUDGET" && error.details?.hardReject === true);
      assert.equal(await BudgetException.findOne({ request: overBudget._id }), null, "Phase 2's default REJECT strategy does not raise an exception");

      const withinBudget = make(center, 60);
      const commitment = await reserveBudget(withinBudget, budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.COMMITTED);
      assert.equal(commitment.lines[0].mode, "ACTIVE");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 60, "Phase 2 reserves real, pooled funds");
    });

    await t.test("a BudgetRule overrides the Cost Center's own default mode in both directions", async () => {
      const transitionalCenter = await CostCenter.create({ code: "RULE-OVERRIDE-1", name: "Rule override 1", area: "Finance", annualBudget: 100, budgetMode: "TRANSITIONAL", active: true });
      const expenseType = new mongoose.Types.ObjectId();
      await BudgetRule.create({ name: "Force active", mode: "ACTIVE", exceptionStrategy: "REJECT", costCenter: transitionalCenter._id, expenseType, active: true });
      const forcedActive = { ...make(transitionalCenter, 500), lines: [{ costCenter: transitionalCenter._id, expenseType, totalAmount: 500 }] };
      await assert.rejects(() => reserveBudget(forcedActive, budget._id), (error) => error.code === "INSUFFICIENT_BUDGET", "an ACTIVE rule blocks even though the Cost Center default is TRANSITIONAL");

      const activeCenter = await CostCenter.create({ code: "RULE-OVERRIDE-2", name: "Rule override 2", area: "Finance", annualBudget: 100, budgetMode: "ACTIVE", active: true });
      const expenseType2 = new mongoose.Types.ObjectId();
      await BudgetRule.create({ name: "Force transitional", mode: "TRANSITIONAL", exceptionStrategy: "REJECT", costCenter: activeCenter._id, expenseType: expenseType2, active: true });
      const forcedTransitional = { ...make(activeCenter, 500), lines: [{ costCenter: activeCenter._id, expenseType: expenseType2, totalAmount: 500 }] };
      const commitment = await reserveBudget(forcedTransitional, budget._id);
      assert.equal(commitment.status, BUDGET_STATUS.NO_BUDGET, "a TRANSITIONAL rule keeps this informational even though the Cost Center default is ACTIVE");
      assert.equal((await CostCenter.findById(activeCenter._id)).committedAmount, 0);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
