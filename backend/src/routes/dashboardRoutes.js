import { Router } from "express";
import { getBudgetExceptionDecisions, getDashboardSummary, getPersonalDashboard, getTaskSummary, getJefeInvoices } from "../controllers/dashboardController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect);
router.get("/summary", getDashboardSummary);
router.get("/tasks", getTaskSummary);
router.get("/me", getPersonalDashboard);
router.get("/invoices", getJefeInvoices);
// Reviewed budget exceptions awaiting Management's decision (Approval Inbox). Admin reads them;
// the decision itself stays POST /budget/exceptions/:id/decision, which only Management passes.
router.get("/decisions/budget-exceptions", authorize(ROLES.ADMIN, ROLES.MANAGEMENT), getBudgetExceptionDecisions);

export default router;
