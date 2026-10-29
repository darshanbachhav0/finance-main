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
// Admin, Treasury and the Super Admin set each CECO's annual budget and change it (moving money
// between months, reserve, annual amount, planning mode, roll-forward); changes above the
// approval threshold wait for Management.
router.post("/plans", authorizePermission(PERMISSIONS.BUDGET_MANAGE), addBudgetPlan);
router.post("/plans/:id/adjustments", authorizePermission(PERMISSIONS.BUDGET_MANAGE), changeBudgetPlan);
router.get("/plan-changes", listPlanChanges);
router.post("/plan-changes/:id/decision", authorize(ROLES.MANAGEMENT), decidePlanChange);
router.post("/plan-changes/:id/cancel", authorizePermission(PERMISSIONS.BUDGET_MANAGE), cancelPlanChange);
router.get("/allocations", listBudgetAllocations);
router.get("/commitments", listBudgetCommitments);
router.get("/exceptions", listBudgetExceptions);
router.post("/exceptions/:id/decision", authorize(ROLES.TREASURY, ROLES.MANAGEMENT), decideBudgetException);
router.post("/requests/:id/commit", authorizePermission(PERMISSIONS.BUDGET_MANAGE), commitRequestBudget);
router.post("/year-end/carry-over", authorizePermission(PERMISSIONS.BUDGET_MANAGE), runYearEndCarryOver);
export default router;
