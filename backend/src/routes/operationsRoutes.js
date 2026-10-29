import { Router } from "express";
import fs from "node:fs/promises";
import { authorizePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadFields } from "../middleware/upload.js";
import { submissionReadiness, requestReadiness } from "../services/operationsReadinessService.js";
import { previewPaymentBatch } from "../services/treasuryService.js";
import { parseInvoiceXml } from "../services/xmlValidationService.js";
import { AppError } from "../utils/AppError.js";
// Read-only checks the request and Treasury pages use: a request's readiness, the submission check,
// the payment preflight and the XML preview.
const router = Router();
router.get("/requests/:id", asyncHandler(async (req, res) => res.json({ data: await requestReadiness(req.params.id, req.user) })));
router.post("/submission", authorizePermission(PERMISSIONS.REQUEST_CREATE), asyncHandler(async (req, res) => res.json({ data: await submissionReadiness(req.body, req.user) })));
router.post("/payments", authorizePermission(PERMISSIONS.TREASURY_GENERATE_BATCH), asyncHandler(async (req, res) => res.json({ data: await previewPaymentBatch(req.body) })));
router.post("/xml-preview", authorizePermission(PERMISSIONS.ACCOUNTING_PROVISION, PERMISSIONS.REQUEST_CREATE), uploadFields, asyncHandler(async (req, res) => {
  try {
    const file = req.files?.xml?.[0];
    if (!file) throw new AppError(422, "Upload the invoice XML.");
    res.json({ data: await parseInvoiceXml(file.path), verified: false });
  } finally { await Promise.all(Object.values(req.files || {}).flat().map(file => fs.rm(file.path, { force: true }))); }
}));
export default router;
