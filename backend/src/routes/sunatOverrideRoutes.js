import { Router } from "express";
import { manualSunatOverride } from "../controllers/sunatOverrideController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

// Mounted at "/requests" (see routes/index.js), alongside requestRoutes.js. Kept as its own
// router/controller pair so this SUNAT-integration exception action stays isolated from the
// generic request lifecycle handlers in requestController.js.
const router = Router();
router.use(protect);
router.post("/:id/invoice/:voucherId/manual-sunat-override", authorizePermission(PERMISSIONS.ACCOUNTING_PROVISION), manualSunatOverride);

export default router;
