import { Router } from "express";
import { listAuditLogs, requestAuditTimeline } from "../controllers/auditController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();
router.use(protect, authorizePermission(PERMISSIONS.AUDIT_VIEW));
router.get("/", listAuditLogs);
router.get("/requests/:id", requestAuditTimeline);
export default router;

