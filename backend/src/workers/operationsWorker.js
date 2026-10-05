import Supplier from "../models/Supplier.js";
import { evaluateSupplierHomologation } from "../services/supplierService.js";
import { notifyRoles, resolveNotification } from "../services/notificationService.js";
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
      // Cursor traversal prevents a permanently incomplete oldest record from starving newer ones.
      for await (const supplier of Supplier.find({ homologationStatus: { $in: ["PENDING_VALIDATION", "OBSERVED", "HOMOLOGATED"] } }).cursor()) {
        if (stopping) break;
        const eventKey = `supplier:${supplier._id}:finance-ready`;
        if (supplier.homologationStatus === "HOMOLOGATED") { await resolveNotification(eventKey); continue; }
        const readiness = await evaluateSupplierHomologation(supplier);
        if (readiness.summary.requiredDocumentsPresent) await notifyRoles({ once: true, roles: ["Accounting", "Admin"], eventKey, type: "SUPPLIER_REVIEW", title: "Supplier evidence ready for Finance review", message: `${supplier.legalName || supplier.name}: review taxpayer, banking and compliance requirements.`, path: "/suppliers", entityType: "Supplier", entityId: supplier._id });
        else await resolveNotification(eventKey);
      }
    } catch (error) { console.error("[OPERATIONS] Draft preparation failed", error.message); }
    if (!stopping) await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 3600000); });
  } })();
  return { name: "operations", done, async stop() { stopping = true; clearTimeout(timer); wake?.(); await done; } };
}
