import { Router } from "express";
import { exportSire, listSireExports, previewSire } from "../controllers/sireController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING));
router.get("/preview", previewSire);
router.get("/export", exportSire);
router.get("/exports", listSireExports);

export default router;
