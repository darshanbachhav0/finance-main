import { asyncHandler } from "../middleware/asyncHandler.js";
import { listBankFilesForVerification, rejectBankFile, reviewBankFile, verifyBankFile } from "../services/bankFileVerificationService.js";

export const listBankFiles = asyncHandler(async (req, res) => res.json(await listBankFilesForVerification(req.query)));
export const reviewBankFileChecks = asyncHandler(async (req, res) => res.json({ data: await reviewBankFile(req.params.id) }));
export const verifyBankFileAction = asyncHandler(async (req, res) => {
  const result = await verifyBankFile({ batchId: req.params.id, user: req.user, req });
  res.json({ data: result.batch, paymentDateWarning: result.paymentDateWarning });
});
export const rejectBankFileAction = asyncHandler(async (req, res) => {
  const result = await rejectBankFile({ batchId: req.params.id, payload: req.body, user: req.user, req });
  res.json({ data: result.batch });
});
