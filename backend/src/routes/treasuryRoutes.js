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
import { asyncHandler } from "../middleware/asyncHandler.js";
import { advancesDueSummary, nextPaymentRunSummary, getPaymentBatchSummary } from "../services/treasuryService.js";
import { useCurrentBankAccountForAdvance } from "../services/advanceDestinationService.js";
import { createTreasuryTransfer, executeTreasuryTransfer, listTreasuryAccounts, listTreasuryTransfers, reconcileTreasuryTransfer, resubmitTreasuryTransfer, saveTreasuryAccount } from "../services/treasuryTransferService.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

// SPOT master data: readable by Finance roles, maintained by Accounting/Admin (the service
// enforces the write roles too). Declared before the Treasury-only guard below.
router.get("/spot-categories", protect, authorize(ROLES.ADMIN, ROLES.TREASURY, ROLES.ACCOUNTING), spotCategories);
router.put("/spot-categories/:code", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), saveSpotCategory);
router.put("/suppliers/:id/detraction-account", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING), saveSupplierDetractionAccount);
router.get("/bank-files/:id/summary", protect, authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF), asyncHandler(async (req, res) => {
  const data = await getPaymentBatchSummary(req.params.id, { csv: req.query.format === "csv" });
  if (req.query.format === "csv") return res.type("text/csv; charset=utf-8").attachment(data.fileName).send(data.content);
  res.json({ data });
}));

// Track D: UMA's own bank accounts and the transfers between them. Treasury registers and executes
// them; the GAF (who approves them) and Accounting read them.
const TRANSFER_READERS = [ROLES.ADMIN, ROLES.TREASURY, ROLES.GAF, ROLES.ACCOUNTING];
router.get("/accounts", protect, authorize(...TRANSFER_READERS), asyncHandler(async (req, res) => res.json({ data: await listTreasuryAccounts({ includeInactive: req.query.includeInactive === "true" }) })));
router.post("/accounts", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.status(201).json({ data: await saveTreasuryAccount({ body: req.body, user: req.user, req }) })));
router.put("/accounts/:id", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.json({ data: await saveTreasuryAccount({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.get("/transfers", protect, authorize(...TRANSFER_READERS), asyncHandler(async (req, res) => res.json(await listTreasuryTransfers(req.query))));
router.post("/transfers", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.status(201).json({ data: await createTreasuryTransfer({ body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/resubmit", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.json({ data: await resubmitTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/execute", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.json({ data: await executeTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/reconcile", protect, authorize(ROLES.ADMIN, ROLES.TREASURY), asyncHandler(async (req, res) => res.json({ data: await reconcileTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));

router.use(protect, authorize(ROLES.ADMIN, ROLES.TREASURY));
router.get("/queue", paymentQueue);
// The next 15th / last-working-day payment run and what falls into it (Payments page banner).
router.get("/next-run", asyncHandler(async (_req, res) => res.json({ data: await nextPaymentRunSummary() })));
router.get("/advances-due", asyncHandler(async (_req, res) => res.json({ data: await advancesDueSummary() })));
// An unpaid advance switches to the employee's current verified bank account.
router.post("/payables/:id/use-current-bank-account", asyncHandler(async (req, res) => res.json({ data: await useCurrentBankAccountForAdvance({ accountsPayableId: req.params.id, user: req.user, req }) })));
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
