import { Router } from "express";
import {
  commitRequestBudget,
  decideBudgetException,
  getBudgetOverview,
  listBudgetAllocations,
  listBudgetCommitments,
  listBudgetExceptions,
  runYearEndCarryOver
} from "../controllers/budgetController.js";
import { addBudgetPlan, cancelPlanChange, changeBudgetPlan, decidePlanChange, listPlanChanges, readBudgetPlan } from "../controllers/budgetController.js";
import { authorize, authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS, ROLES } from "../utils/constants.js";

const router = Router();
// "View budget": the roles that hold it by default, plus anyone granted it.
router.use(protect, authorizePermission(PERMISSIONS.BUDGET_VIEW));
router.get("/overview", getBudgetOverview);
router.get("/plans/:id", readBudgetPlan);
router.post("/plans", authorize(ROLES.ADMIN, ROLES.BUDGET), addBudgetPlan);
// Changing an existing plan (moving money between months, reserve, annual amount, planning
// mode, roll-forward) is Admin only; changes above the approval threshold wait for Management.
router.post("/plans/:id/adjustments", authorize(ROLES.ADMIN), changeBudgetPlan);
router.get("/plan-changes", listPlanChanges);
router.post("/plan-changes/:id/decision", authorize(ROLES.MANAGEMENT), decidePlanChange);
router.post("/plan-changes/:id/cancel", authorize(ROLES.ADMIN), cancelPlanChange);
router.get("/allocations", listBudgetAllocations);
router.get("/commitments", listBudgetCommitments);
router.get("/exceptions", listBudgetExceptions);
router.post("/exceptions/:id/decision", authorize(ROLES.ADMIN, ROLES.BUDGET, ROLES.MANAGEMENT), decideBudgetException);
router.post("/requests/:id/commit", authorize(ROLES.ADMIN, ROLES.BUDGET), commitRequestBudget);
router.post("/year-end/carry-over", authorize(ROLES.ADMIN, ROLES.BUDGET), runYearEndCarryOver);
export default router;
