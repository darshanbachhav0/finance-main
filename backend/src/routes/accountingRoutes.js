import { Router } from "express";
import {
  consolidationPreview,
  exportConsolidation,
  listAccountingExports,
  listAccountsPayable,
  listEntries,
  listPendingAccounting,
  processPayable
} from "../controllers/accountingController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING));
router.get("/entries", listEntries);
router.get("/accounts-payable", listAccountsPayable);
router.get("/pending", listPendingAccounting);
router.post("/requests/:id/process", processPayable);
router.get("/consolidation", consolidationPreview);
router.get("/consolidation/export", exportConsolidation);
router.get("/exports", listAccountingExports);

export default router;
