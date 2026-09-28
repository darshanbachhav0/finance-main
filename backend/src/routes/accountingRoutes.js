import { Router } from "express";
import {
  cancelPayable,
  consolidationPreview,
  exportConsolidation,
  listAccountingExports,
  listAccountsPayable,
  listEntries,
  listPendingAccounting,
  listSunatObservations,
  processPayable,
  registerNote,
  supplierCredits,
  applyCredit,
  recoverCredit
} from "../controllers/accountingController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING));
router.get("/entries", listEntries);
router.get("/accounts-payable", listAccountsPayable);
router.post("/accounts-payable/:id/cancel", cancelPayable);
router.get("/pending", listPendingAccounting);
router.get("/sunat-observations", listSunatObservations);
router.post("/adjustment-notes", uploadFields, registerNote);
router.get("/supplier-credits", supplierCredits);
router.post("/supplier-credits/:id/apply", applyCredit);
router.post("/supplier-credits/:id/recover", recoverCredit);
router.post("/requests/:id/process", processPayable);
router.get("/consolidation", consolidationPreview);
router.get("/consolidation/export", exportConsolidation);
router.get("/exports", listAccountingExports);

export default router;
