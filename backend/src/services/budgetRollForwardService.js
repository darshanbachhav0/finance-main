import BudgetAllocation from "../models/BudgetAllocation.js";
import { recordAudit } from "./auditService.js";
import { budgetAvailable } from "./budgetAllocationService.js";
import { lastEndedMonth } from "./budgetPlanService.js";
import { addMoney, roundMoney } from "../utils/money.js";
import { BUDGET_MONTHS } from "../../../shared/budgetPlanning.mjs";

// Automatic roll-forward (annual + monthly plans with the switch on): when a month ends, its
// unused budget (assigned - committed - executed) moves to the next month. Each month end is
// handled once (rollForward.lastRolledMonth), in order, so a chain of unused months carries
// forward step by step. December never rolls: the year-end carry-over handles the new year.
// Each move is recorded in the plan history and the audit log as ROLL_FORWARD.
export async function rollForwardUnusedBudget({ now = new Date() } = {}) {
  const summary = { plans: 0, moves: 0, amount: 0 };
  const plans = BudgetAllocation.find({ planningMode: "ANNUAL_MONTHLY", active: true, "rollForward.enabled": true }).cursor();
  for await (let plan of plans) {
    const ended = Math.min(lastEndedMonth(plan.period, now), 11);
    let touched = false;
    for (let month = (plan.rollForward?.lastRolledMonth || 0) + 1; month <= ended; month += 1) {
      const unused = roundMoney(Math.max(0, budgetAvailable(plan.months[month - 1])));
      const update = { $inc: { __v: 1 }, $set: { "rollForward.lastRolledMonth": month } };
      let entry;
      if (unused > 0) {
        update.$inc[`months.${month - 1}.assignedAmount`] = -unused;
        update.$inc[`months.${month}.assignedAmount`] = unused;
        entry = {
          operationId: `roll-forward-${plan._id}-${plan.period}-${month}`,
          action: "ROLL_FORWARD", amount: unused, fromMonth: month, toMonth: month + 1,
          annualBefore: plan.assignedAmount, annualAfter: plan.assignedAmount,
          reason: `Unused budget of ${BUDGET_MONTHS[month - 1]} moved to ${BUDGET_MONTHS[month]} automatically at month end.`,
          by: plan.rollForward.enabledBy, actorName: "Automatic roll-forward", at: now
        };
        update.$push = { adjustments: entry };
      }
      // Guarded on the plan version and the switch, so a concurrent Admin edit or a switch-off
      // wins; the next run simply continues from lastRolledMonth.
      const next = await BudgetAllocation.findOneAndUpdate(
        { _id: plan._id, __v: plan.__v, "rollForward.enabled": true, "rollForward.lastRolledMonth": month - 1 },
        update,
        { new: true }
      );
      if (!next) break;
      plan = next;
      touched = true;
      if (entry) {
        summary.moves += 1;
        summary.amount = addMoney(summary.amount, unused);
        await recordAudit({ entityType: "BudgetAllocation", entity: next, action: "ROLL_FORWARD", module: "BUDGET", period: next.period, user: next.rollForward.enabledBy ? { _id: next.rollForward.enabledBy } : undefined, comments: entry.reason, newValues: entry });
      }
    }
    if (touched) summary.plans += 1;
  }
  return summary;
}
