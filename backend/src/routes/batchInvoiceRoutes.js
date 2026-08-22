import { Router } from "express";
import {
  createBatch,
  eligiblePurchaseOrders,
  getBatch,
  listBatches,
  observationDocument,
  observations,
  resolveObservation,
  retryBatch
} from "../controllers/batchInvoiceController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();
router.use(protect);
router.get("/purchase-orders", authorizePermission(PERMISSIONS.BATCH_INVOICE_UPLOAD), eligiblePurchaseOrders);
router.get("/observations", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), observations);
router.get("/observations/:id/:kind", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), observationDocument);
router.post("/observations/:id/resolve", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), uploadFields, resolveObservation);
// Compatibility aliases for clients deployed before the dedicated observation model.
router.get("/vouchers/:id/:kind", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), observationDocument);
router.post("/vouchers/:id/resolve", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), uploadFields, resolveObservation);
router.get("/", authorizePermission(PERMISSIONS.BATCH_INVOICE_UPLOAD), listBatches);
router.post("/", authorizePermission(PERMISSIONS.BATCH_INVOICE_UPLOAD), uploadFields, createBatch);
router.get("/:id", authorizePermission(PERMISSIONS.BATCH_INVOICE_UPLOAD), getBatch);
router.post("/:id/process", authorizePermission(PERMISSIONS.BATCH_INVOICE_REVIEW), retryBatch);
export default router;
