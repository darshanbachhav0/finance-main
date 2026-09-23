import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { getManagementSection } from "../controllers/externalManagementController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";
import { managementOpenApi } from "../docs/managementOpenApi.js";

const router = Router();

router.get("/openapi.json", (_req, res) => res.json(managementOpenApi));
router.use(protect, authorizePermission(PERMISSIONS.MANAGEMENT_PORTAL_VIEW));
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Math.max(30, Number(process.env.MANAGEMENT_API_RATE_LIMIT || 240)),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, code: "RATE_LIMITED", message: "Management API request limit exceeded. Try again shortly." }
}));

for (const section of ["overview", "budget", "workflow", "payments", "sla", "filters"]) {
  router.get(`/${section}`, getManagementSection(section));
}

export default router;
