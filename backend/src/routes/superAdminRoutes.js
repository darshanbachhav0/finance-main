import { Router } from "express";
import {
  activateAdministrator,
  addAdministrator,
  administratorHistory,
  administrators,
  alerts,
  auditFacets,
  auditLog,
  backups,
  deactivateAdministrator,
  demote,
  editAdministrator,
  overview,
  promote,
  promotionCandidates,
  resetPassword,
  runBackup,
  saveSettings,
  settings,
  signOutEverywhere,
  unlock
} from "../controllers/superAdminController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

// Super Admin console: administrator accounts, oversight and platform settings. Only the Super
// Admin reaches it (an Admin is refused even on reads); nothing here acts in a financial process.
const router = Router();
router.use(protect, authorize(ROLES.SUPER_ADMIN));

router.get("/overview", overview);

router.get("/administrators", administrators);
router.post("/administrators", addAdministrator);
router.get("/administrators/promotion-candidates", promotionCandidates);
router.post("/administrators/promote", promote);
router.get("/administrators/:id/activity", administratorHistory);
router.put("/administrators/:id", editAdministrator);
router.post("/administrators/:id/activate", activateAdministrator);
router.post("/administrators/:id/deactivate", deactivateAdministrator);
router.post("/administrators/:id/reset-password", resetPassword);
router.post("/administrators/:id/unlock", unlock);
router.post("/administrators/:id/sign-out", signOutEverywhere);
router.post("/administrators/:id/demote", demote);

router.get("/audit", auditLog);
router.get("/audit/facets", auditFacets);
router.get("/alerts", alerts);

router.get("/settings", settings);
router.put("/settings", saveSettings);
router.get("/backups", backups);
router.post("/backups", runBackup);

export default router;
