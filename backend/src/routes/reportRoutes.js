import { Router } from "express";
import { exportManagementReport, listManagementExports, managementSummary } from "../controllers/reportController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { buildWeeklyReport } from "../services/weeklyReportService.js";

const router = Router();
router.use(protect, authorizePermission(PERMISSIONS.REPORT_VIEW));
// ManagementViewer is deliberately absent: it only reaches the aggregate /management/v1 portal API.
router.get("/management", managementSummary);
router.get("/management/export", exportManagementReport);
router.get("/management/exports", listManagementExports);
// The weekly Excel report (also emailed every Monday), for download at any time.
router.get("/weekly.xlsx", asyncHandler(async (_req, res) => {
  const report = await buildWeeklyReport();
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${report.fileName}"` });
  res.send(report.buffer);
}));
export default router;
