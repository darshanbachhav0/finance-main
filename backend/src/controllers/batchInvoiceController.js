import path from "path";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  createMassUploadBatch,
  getMassUploadBatch,
  getObservationDocument,
  listEligiblePurchaseOrders,
  listInvoiceObservations,
  listMassUploadBatches,
  retryInvoiceObservation,
  retryMassUploadBatch
} from "../services/batchInvoiceService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

export const eligiblePurchaseOrders = asyncHandler(async (req, res) => res.json({ data: await listEligiblePurchaseOrders(req.query, req.user) }));
export const listBatches = asyncHandler(async (req, res) => res.json(await listMassUploadBatches(req.query, req.user)));
export const getBatch = asyncHandler(async (req, res) => res.json({ data: await getMassUploadBatch(req.params.id, req.user) }));
export const createBatch = asyncHandler(async (req, res) => {
  const batch = await createMassUploadBatch({ purchaseOrderId: req.body.purchaseOrderId, files: req.files, user: req.user, req });
  res.status(202).json({ data: batch, message: "Batch accepted for asynchronous processing." });
});
export const retryBatch = asyncHandler(async (req, res) => res.status(202).json({ data: await retryMassUploadBatch(req.params.id, req.user) }));
export const observations = asyncHandler(async (req, res) => res.json(await listInvoiceObservations(req.query)));

export const resolveObservation = asyncHandler(async (req, res) => {
  const result = await retryInvoiceObservation({ observationId: req.params.id, files: req.files, acceptXmlValues: req.body.acceptXmlValues === "true" || req.body.acceptXmlValues === true, user: req.user, req });
  res.json({ data: result.observation, voucher: result.voucher, accountsPayable: result.accountsPayable, request: result.request });
});

export const observationDocument = asyncHandler(async (req, res) => {
  const kind = String(req.params.kind || "").toLowerCase();
  if (!["xml", "pdf"].includes(kind)) throw new AppError(422, "Document kind must be xml or pdf.", { kind }, ERROR_CODES.VALIDATION_ERROR);
  const filePath = await getObservationDocument(req.params.id, kind);
  if (!filePath) throw new AppError(404, "Observation document is not available.", { kind }, ERROR_CODES.NOT_FOUND);
  res.download(filePath, path.basename(filePath));
});
