import { Router } from "express";
import {
  alerts,
  auditFacets,
  auditLog,
  backups,
  overview,
  runBackup,
  saveSettings,
  settings
} from "../controllers/administrationController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

// Administración: platform health, security alerts, access settings, backups and the
// administrative audit trail. Nothing here acts in a financial process. Employees, roles and
// permissions are managed under /users.
const router = Router();
router.use(protect);

const platform = authorizePermission(PERMISSIONS.PLATFORM_MANAGE);
router.get("/overview", platform, overview);
router.get("/alerts", platform, alerts);
router.get("/settings", platform, settings);
router.put("/settings", platform, saveSettings);
router.get("/backups", platform, backups);
router.post("/backups", platform, runBackup);

// The administrator reads the administrative modules; Auditoría and the GAF read the whole trail.
router.get("/audit", authorizePermission(PERMISSIONS.AUDIT_READ), auditLog);
router.get("/audit/facets", authorizePermission(PERMISSIONS.AUDIT_READ), auditFacets);

export default router;
