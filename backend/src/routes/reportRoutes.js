import { Router } from "express";
import { exportManagementReport, listManagementExports, managementSummary } from "../controllers/reportController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();
router.use(protect, authorizePermission(PERMISSIONS.REPORT_VIEW));
// ManagementViewer is deliberately absent: it only reaches the aggregate /management/v1 portal API.
router.get("/management", managementSummary);
router.get("/management/export", exportManagementReport);
router.get("/management/exports", listManagementExports);
export default router;
