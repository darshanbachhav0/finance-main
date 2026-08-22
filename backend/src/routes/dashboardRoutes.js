import { Router } from "express";
import { getDashboardSummary, getTaskSummary } from "../controllers/dashboardController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.use(protect);
router.get("/summary", getDashboardSummary);
router.get("/tasks", getTaskSummary);

export default router;
