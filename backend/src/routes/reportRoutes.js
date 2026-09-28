import { Router } from "express";
import { exportManagementReport, listManagementExports, managementSummary } from "../controllers/reportController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use(protect, authorize(ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.BUDGET, ROLES.PROCUREMENT, ROLES.MANAGEMENT));
// ManagementViewer is deliberately absent: it only reaches the aggregate /management/v1 portal API.
router.get("/management", managementSummary);
router.get("/management/export", exportManagementReport);
router.get("/management/exports", listManagementExports);
export default router;
