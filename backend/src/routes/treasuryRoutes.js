import { Router } from "express";
import {
  confirmPayment,
  confirmPayablePayment,
  bouncePayablePayment,
  bouncedPaymentQueue,
  reprogramPayablePayment,
  eligiblePaymentDestinations,
  eligiblePayablePaymentDestinations,
  generateBankFile,
  listBankFiles,
  paymentConfirmationQueue,
  paymentQueue,
  reconciliationQueue,
  reconcileRequestPayment,
  schedulePaymentRequests
} from "../controllers/treasuryController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
router.get("/bank-files", listBankFiles);
router.get("/payment-confirmations", paymentConfirmationQueue);
router.get("/bounced-payments", bouncedPaymentQueue);
router.get("/reconciliation", reconciliationQueue);
router.get("/requests/:id/eligible-accounts", eligiblePaymentDestinations);
router.get("/payables/:id/eligible-accounts", eligiblePayablePaymentDestinations);
router.post("/schedule", schedulePaymentRequests);
router.post("/bank-file", generateBankFile);
router.post("/requests/:id/confirm-payment", confirmPayment);
router.post("/payables/:id/confirm-payment", confirmPayablePayment);
router.post("/payables/:id/bounce", bouncePayablePayment);
router.post("/payables/:id/reprogram", uploadFields, reprogramPayablePayment);
router.post("/requests/:id/reconcile", reconcileRequestPayment);

export default router;
