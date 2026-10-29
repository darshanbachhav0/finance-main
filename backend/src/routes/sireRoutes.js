import { Router } from "express";
import { exportSire, listSireExports, previewSire } from "../controllers/sireController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();

router.use(protect, authorizePermission(PERMISSIONS.ACCOUNTING_EXPORT));
router.get("/preview", previewSire);
router.get("/export", exportSire);
router.get("/exports", listSireExports);

export default router;
