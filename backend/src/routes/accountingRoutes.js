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
import { listBankFiles, rejectBankFileAction, reviewBankFileChecks, verifyBankFileAction } from "../controllers/bankFileVerificationController.js";
import { authorize, authorizePermission, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { PERMISSIONS, ROLES } from "../utils/constants.js";

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
// Bank TXT verification: Treasury downloads a file only after Accounting verifies it here.
router.get("/bank-files", authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), listBankFiles);
router.get("/bank-files/:id/checks", authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), reviewBankFileChecks);
router.post("/bank-files/:id/verify", authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), verifyBankFileAction);
router.post("/bank-files/:id/reject", authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), rejectBankFileAction);

export default router;
