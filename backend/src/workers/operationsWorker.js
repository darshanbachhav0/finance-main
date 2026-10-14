import { remindSupplierApprovers } from "../services/supplierService.js";
import { resolveNotification } from "../services/notificationService.js";
import { generateDueDrafts } from "../services/recurringDraftService.js";
import { rollForwardUnusedBudget } from "../services/budgetRollForwardService.js";
export function startOperationsWorker() {
  let stopping = false, timer, wake;
  const done = (async () => { while (!stopping) {
    // Month-end roll-forward of unused monthly budget (plans with the switch on). Runs on its own
    // so a failure here never stops draft preparation, and vice versa.
    try {
      const rolled = await rollForwardUnusedBudget();
      if (rolled.moves) console.log(`[OPERATIONS] Budget roll-forward: ${rolled.moves} month(s) moved in ${rolled.plans} plan(s).`);
    } catch (error) { console.error("[OPERATIONS] Budget roll-forward failed", error.message); }
    try {
      await generateDueDrafts();
      // Suppliers are approved by the proposer's jefe, not reviewed by Accounting: close Accounting's
      // old "ready for Finance review" alerts and remind whoever decides each waiting proposal now.
      await resolveNotification(/^supplier:[a-f0-9]{24}:finance-ready$/);
      if (!stopping) await remindSupplierApprovers();
    } catch (error) { console.error("[OPERATIONS] Draft preparation failed", error.message); }
    if (!stopping) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 3600000); });
  } })();
  return { name: "operations", done, async stop() { stopping = true; clearTimeout(timer); wake?.(); await done; } };
}
