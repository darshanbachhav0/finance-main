import { Router } from "express";
import { exportManagementReport, listManagementExports, managementSummary } from "../controllers/reportController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use(protect, authorize(ROLES.ADMIN, ROLES.APPROVER, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.BUDGET, ROLES.PROCUREMENT, ROLES.MANAGEMENT, ROLES.MANAGEMENT_VIEWER));
router.get("/management", managementSummary);
router.get("/management/export", exportManagementReport);
router.get("/management/exports", listManagementExports);
export default router;
