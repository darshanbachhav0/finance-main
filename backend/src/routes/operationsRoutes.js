import { Router } from "express";
import fs from "node:fs/promises";
import { authorize } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadFields } from "../middleware/upload.js";
import { submissionReadiness, requestReadiness } from "../services/operationsReadinessService.js";
import { operationsQueue, supplierReviewQueue, configurationHealth, monthEndReadiness } from "../services/operationsWorkspaceService.js";
import { previewPaymentBatch } from "../services/treasuryService.js";
import { parseInvoiceXml } from "../services/xmlValidationService.js";
import { importStatement, confirmStatementMatch } from "../services/reconciliationSuggestionService.js";
import { createRecurringTemplate, RecurringTemplate } from "../services/recurringDraftService.js";
import { recordAudit } from "../services/auditService.js";
import { AppError } from "../utils/AppError.js";
const router = Router();
router.get("/queue", asyncHandler(async (req, res) => res.json(await operationsQueue(req.user, req.query))));
router.get("/requests/:id", asyncHandler(async (req, res) => res.json({ data: await requestReadiness(req.params.id, req.user) })));
router.post("/submission", authorize("Admin", "Solicitor"), asyncHandler(async (req, res) => res.json({ data: await submissionReadiness(req.body, req.user) })));
router.get("/suppliers", asyncHandler(async (req, res) => res.json(await supplierReviewQueue(req.user))));
router.get("/health", authorize("Admin"), asyncHandler(async (req, res) => res.json({ data: await configurationHealth() })));
router.get("/month-end", authorize("Admin", "Accounting"), asyncHandler(async (req, res) => res.json({ data: await monthEndReadiness(req.query.period) })));
router.post("/payments", authorize("Admin", "Treasury"), asyncHandler(async (req, res) => res.json({ data: await previewPaymentBatch(req.body) })));
router.post("/xml-preview", authorize("Admin", "Solicitor", "Accounting"), uploadFields, asyncHandler(async (req, res) => {
  try {
    const file = req.files?.xml?.[0];
    if (!file) throw new AppError(422, "Upload the invoice XML.");
    res.json({ data: await parseInvoiceXml(file.path), verified: false });
  } finally { await Promise.all(Object.values(req.files || {}).flat().map(file => fs.rm(file.path, { force: true }))); }
}));
router.post("/statements", authorize("Admin", "Treasury"), asyncHandler(async (req, res) => res.json({ data: await importStatement(req.body.csv, req.user, req) })));
router.post("/statements/:id/confirm", authorize("Admin", "Treasury"), asyncHandler(async (req, res) => res.json({ data: await confirmStatementMatch({ ...req.body, id: req.params.id, user: req.user, req }) })));
router.get("/templates", authorize("Admin", "Solicitor"), asyncHandler(async (req, res) => res.json({ data: await RecurringTemplate.find({ owner: req.user._id }).sort({ createdAt: -1 }).limit(100) })));
router.post("/templates", authorize("Admin", "Solicitor"), asyncHandler(async (req, res) => res.status(201).json({ data: await createRecurringTemplate(req.body, req.user, req) })));
router.post("/templates/:id/pause", authorize("Admin", "Solicitor"), asyncHandler(async (req, res) => {
  const record = await RecurringTemplate.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, { $set: { active: false } }, { new: true });
  if (!record) throw new AppError(404, "Template not found.");
  await recordAudit({ entityType: "RecurringTemplate", entity: record, action: "TEMPLATE_PAUSED", user: req.user, req, module: "REQUESTS" });
  res.json({ data: record });
}));
export default router;
