import { Router } from "express";
import {
  commitRequestBudget,
  decideBudgetException,
  getBudgetOverview,
  listBudgetAllocations,
  listBudgetCommitments,
  listBudgetExceptions
} from "../controllers/budgetController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use(protect, authorize(ROLES.ADMIN, ROLES.APPROVER, ROLES.ACCOUNTING, ROLES.BUDGET, ROLES.MANAGEMENT));
router.get("/overview", getBudgetOverview);
router.get("/allocations", listBudgetAllocations);
router.get("/commitments", listBudgetCommitments);
router.get("/exceptions", listBudgetExceptions);
router.post("/exceptions/:id/decision", authorize(ROLES.ADMIN, ROLES.BUDGET), decideBudgetException);
router.post("/requests/:id/commit", authorize(ROLES.ADMIN, ROLES.BUDGET), commitRequestBudget);
export default router;
