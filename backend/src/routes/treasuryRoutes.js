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
import { authorizePermission, protect } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { advancesDueSummary, nextPaymentRunSummary, getPaymentBatchSummary } from "../services/treasuryService.js";
import { useCurrentBankAccountForAdvance } from "../services/advanceDestinationService.js";
import { listPendingTreasuryBudgets } from "../services/treasuryBudgetQueueService.js";
import { createTreasuryTransfer, executeTreasuryTransfer, listTreasuryAccounts, listTreasuryTransfers, reconcileTreasuryTransfer, resubmitTreasuryTransfer, saveTreasuryAccount } from "../services/treasuryTransferService.js";
import { uploadFields } from "../middleware/upload.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();

// SPOT master data: readable by Tesorería and Contabilidad, maintained by Contabilidad (the service
// enforces the write permission too). Declared before the Treasury-only guard below.
router.get("/spot-categories", protect, authorizePermission(PERMISSIONS.TREASURY_SCHEDULE, PERMISSIONS.ACCOUNTING_PROVISION), spotCategories);
router.put("/spot-categories/:code", protect, authorizePermission(PERMISSIONS.ACCOUNTING_CODES_MANAGE), saveSpotCategory);
router.put("/suppliers/:id/detraction-account", protect, authorizePermission(PERMISSIONS.ACCOUNTING_CODES_MANAGE), saveSupplierDetractionAccount);
router.get("/bank-files/:id/summary", protect, authorizePermission(PERMISSIONS.TREASURY_GENERATE_BATCH, PERMISSIONS.BATCH_APPROVE, PERMISSIONS.ACCOUNTING_PROVISION), asyncHandler(async (req, res) => {
  const data = await getPaymentBatchSummary(req.params.id, { csv: req.query.format === "csv" });
  if (req.query.format === "csv") return res.type("text/csv; charset=utf-8").attachment(data.fileName).send(data.content);
  res.json({ data });
}));

// Track D: Tesorería registers and executes transfers, the GAF approves them, Contabilidad reads them.
const readTransfers = authorizePermission(PERMISSIONS.TREASURY_TRANSFER, PERMISSIONS.BATCH_APPROVE, PERMISSIONS.ACCOUNTING_PROVISION);
const manageTransfers = authorizePermission(PERMISSIONS.TREASURY_TRANSFER);
router.get("/accounts", protect, readTransfers, asyncHandler(async (req, res) => res.json({ data: await listTreasuryAccounts({ includeInactive: req.query.includeInactive === "true" }) })));
router.post("/accounts", protect, manageTransfers, asyncHandler(async (req, res) => res.status(201).json({ data: await saveTreasuryAccount({ body: req.body, user: req.user, req }) })));
router.put("/accounts/:id", protect, manageTransfers, asyncHandler(async (req, res) => res.json({ data: await saveTreasuryAccount({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.get("/transfers", protect, readTransfers, asyncHandler(async (req, res) => res.json(await listTreasuryTransfers(req.query))));
router.post("/transfers", protect, manageTransfers, asyncHandler(async (req, res) => res.status(201).json({ data: await createTreasuryTransfer({ body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/resubmit", protect, manageTransfers, asyncHandler(async (req, res) => res.json({ data: await resubmitTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/execute", protect, manageTransfers, asyncHandler(async (req, res) => res.json({ data: await executeTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));
router.post("/transfers/:id/reconcile", protect, manageTransfers, asyncHandler(async (req, res) => res.json({ data: await reconcileTreasuryTransfer({ id: req.params.id, body: req.body, user: req.user, req }) })));

router.use(protect, authorizePermission(PERMISSIONS.TREASURY_SCHEDULE));
router.get("/queue", paymentQueue);
router.get("/pending-budgets", asyncHandler(async (req, res) => res.json(await listPendingTreasuryBudgets(req.query))));
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
router.post("/bank-file", authorizePermission(PERMISSIONS.TREASURY_GENERATE_BATCH), generateBankFile);
router.post("/bank-files/:id/cancel", authorizePermission(PERMISSIONS.TREASURY_GENERATE_BATCH), cancelBankFile);
router.post("/requests/:id/confirm-payment", authorizePermission(PERMISSIONS.TREASURY_EXECUTE_PAYMENT), confirmPayment);
router.post("/payables/:id/confirm-payment", authorizePermission(PERMISSIONS.TREASURY_EXECUTE_PAYMENT), confirmPayablePayment);
router.post("/payables/:id/bounce", authorizePermission(PERMISSIONS.TREASURY_EXECUTE_PAYMENT), bouncePayablePayment);
router.post("/payables/:id/reprogram", uploadFields, reprogramPayablePayment);
router.post("/payables/:id/detraction-deposit", authorizePermission(PERMISSIONS.TREASURY_EXECUTE_PAYMENT), depositDetraction);
router.post("/requests/:id/reconcile", authorizePermission(PERMISSIONS.RECONCILIATION_PREPARE), reconcileRequestPayment);
router.post("/payables/:id/reconcile", authorizePermission(PERMISSIONS.RECONCILIATION_PREPARE), reconcilePayablePayment);

export default router;
