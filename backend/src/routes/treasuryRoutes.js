import { Router } from "express";
import {
  cancelBankFile,
  confirmPayment,
  confirmPayablePayment,
  bouncePayablePayment,
  bouncedPaymentQueue,
  depositDetraction,
  detractionQueue,
  reprogramPayablePayment,
  eligiblePaymentDestinations,
  eligiblePayablePaymentDestinations,
  generateBankFile,
  listBankFiles,
  paymentConfirmationQueue,
  paymentQueue,
  reconciliationQueue,
  reconcileRequestPayment,
  reconcilePayablePayment,
  saveSpotCategory,
  saveSupplierDetractionAccount,
  schedulePaymentRequests,
  spotCategories
} from "../controllers/treasuryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

// SPOT master data: readable by Finance roles, maintained by Accounting/Admin (the service
// enforces the write roles too). Declared before the Treasury-only guard below.
router.get("/spot-categories", protect, authorize(ROLES.ADMIN, ROLES.TREASURY, ROLES.ACCOUNTING), spotCategories);
router.put("/spot-categories/:code", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), saveSpotCategory);
router.put("/suppliers/:id/detraction-account", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), saveSupplierDetractionAccount);

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
router.get("/bank-files", listBankFiles);
router.get("/payment-confirmations", paymentConfirmationQueue);
router.get("/bounced-payments", bouncedPaymentQueue);
router.get("/reconciliation", reconciliationQueue);
router.get("/detractions", detractionQueue);
router.get("/requests/:id/eligible-accounts", eligiblePaymentDestinations);
router.get("/payables/:id/eligible-accounts", eligiblePayablePaymentDestinations);
router.post("/schedule", schedulePaymentRequests);
router.post("/bank-file", generateBankFile);
router.post("/bank-files/:id/cancel", cancelBankFile);
router.post("/requests/:id/confirm-payment", confirmPayment);
router.post("/payables/:id/confirm-payment", confirmPayablePayment);
router.post("/payables/:id/bounce", bouncePayablePayment);
router.post("/payables/:id/reprogram", uploadFields, reprogramPayablePayment);
router.post("/payables/:id/detraction-deposit", depositDetraction);
router.post("/requests/:id/reconcile", reconcileRequestPayment);
router.post("/payables/:id/reconcile", reconcilePayablePayment);

export default router;
