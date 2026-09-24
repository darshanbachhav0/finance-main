import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import BudgetException from "../src/models/BudgetException.js";
import BudgetRule from "../src/models/BudgetRule.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import User from "../src/models/User.js";
import { recordBudgetExceptionDecision, resolveExceptionApproverRole } from "../src/services/budgetExceptionService.js";
import { ROLES } from "../src/utils/constants.js";

test("Budget exception authority is configurable per dimension and amount, defaulting to Management unchanged", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_budget_exception_routing_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const budgetOfficer = await User.create({ name: "Budget Officer", email: "exc-routing-budget@test.local", role: ROLES.BUDGET, passwordHash: "unused" });
    const management = await User.create({ name: "Management", email: "exc-routing-mgmt@test.local", role: ROLES.MANAGEMENT, passwordHash: "unused" });
    const rectorate = await User.create({ name: "Rectorate", email: "exc-routing-rector@test.local", role: ROLES.ADMIN, passwordHash: "unused" });

    async function makeException(overrides = {}) {
      return BudgetException.create({
        request: new mongoose.Types.ObjectId(), dimensionKey: `k-${new mongoose.Types.ObjectId()}`,
        costCenter: overrides.costCenter || new mongoose.Types.ObjectId(),
        expenseType: overrides.expenseType, project: overrides.project,
        strategy: "EXTRAORDINARY_APPROVAL", availableAmount: 0, requestedAmount: overrides.requestedAmount ?? 100,
        requestedBy: budgetOfficer._id, history: [{ action: "CREATED", by: budgetOfficer._id }]
      });
    }

    await t.test("with no matching BudgetRule, Management remains the default authority (unchanged behavior)", async () => {
      const exception = await makeException();
      assert.equal(await resolveExceptionApproverRole(exception), ROLES.MANAGEMENT);
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Trying as Admin", rectorate, {}), (error) => error.statusCode === 403);
      const decided = await recordBudgetExceptionDecision(exception._id, "APPROVED", "Management authorizes", management, {});
      assert.equal(decided.status, "APPROVED");
    });

    await t.test("a configured BudgetRule can route authority to a different role for its dimension", async () => {
      const center = await CostCenter.create({ code: "CC-EXC-ROUTE", name: "Exception Routing", area: "Finance", active: true });
      await BudgetRule.create({ name: "Route to Admin", mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", costCenter: center._id, exceptionApproverRole: ROLES.ADMIN, active: true });
      const exception = await makeException({ costCenter: center._id, requestedAmount: 500 });
      assert.equal(await resolveExceptionApproverRole(exception), ROLES.ADMIN);
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Trying as Management", management, {}), (error) => error.statusCode === 403);
      const decided = await recordBudgetExceptionDecision(exception._id, "APPROVED", "Admin authorizes per configured rule", rectorate, {});
      assert.equal(decided.status, "APPROVED");
    });

    await t.test("amount-based escalation requires the higher authority only above the configured threshold", async () => {
      const center = await CostCenter.create({ code: "CC-EXC-ESCALATE", name: "Exception Escalation", area: "Finance", annualBudget: 100, budgetMode: "ACTIVE", active: true });
      const expenseType = await ExpenseType.create({ code: "EXC-ESC-EXP", name: "Escalation expense", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "603201", active: true });
      await BudgetRule.create({
        name: "Escalate above 1000", mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL",
        costCenter: center._id, expenseType: expenseType._id,
        exceptionApproverRole: ROLES.MANAGEMENT, exceptionEscalationAmount: 1000, exceptionEscalationApproverRole: ROLES.ADMIN,
        active: true
      });
      const belowThreshold = await makeException({ costCenter: center._id, expenseType: expenseType._id, requestedAmount: 500 });
      assert.equal(await resolveExceptionApproverRole(belowThreshold), ROLES.MANAGEMENT);
      const aboveThreshold = await makeException({ costCenter: center._id, expenseType: expenseType._id, requestedAmount: 5000 });
      assert.equal(await resolveExceptionApproverRole(aboveThreshold), ROLES.ADMIN, "a larger exception escalates to the configured higher authority");

      await assert.rejects(() => recordBudgetExceptionDecision(aboveThreshold._id, "APPROVED", "Management trying to approve a large exception", management, {}), (error) => error.statusCode === 403);
      const decided = await recordBudgetExceptionDecision(aboveThreshold._id, "APPROVED", "Escalated authority approves", rectorate, {});
      assert.equal(decided.status, "APPROVED");
    });

    await t.test("Budget still only prepares (REVIEWED), regardless of who the configured final authority is", async () => {
      const center = await CostCenter.create({ code: "CC-EXC-PREP", name: "Prep only", area: "Finance", active: true });
      await BudgetRule.create({ name: "Route to Admin for prep test", mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", costCenter: center._id, exceptionApproverRole: ROLES.ADMIN, active: true });
      const exception = await makeException({ costCenter: center._id });
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Budget cannot self-authorize", budgetOfficer, {}), (error) => error.statusCode === 403);
      const reviewed = await recordBudgetExceptionDecision(exception._id, "REVIEWED", "Budget recommends funding", budgetOfficer, {});
      assert.equal(reviewed.status, "PENDING");
      assert.equal(String(reviewed.preparedBy), String(budgetOfficer._id));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
