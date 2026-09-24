import FinancialRequest from "../models/FinancialRequest.js";
import { applyManualSunatOverride } from "../services/sunatVoucherService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

// Dedicated, separately-authorized manual-exception action (Admin/Accounting only - see
// sunatOverrideRoutes.js). It is distinct from, and never blended into, the automatic SUNAT
// validation path (getSunatProvider() / sunatService.js): it requires a human-supplied reason
// and evidence reference, records who acted and when, and marks the voucher with the explicit
// non-authoritative MANUAL_EXCEPTION status rather than VALID. See sunatVoucherService.js
// (applyManualSunatOverride) for the audited state change.
export const manualSunatOverride = asyncHandler(async (req, res) => {
  const request = await FinancialRequest.findById(req.params.id);
  if (!request) {
    throw new AppError(404, "Financial request not found.", { requestId: req.params.id }, ERROR_CODES.NOT_FOUND);
  }
  const voucher = await applyManualSunatOverride({
    request,
    voucherId: req.params.voucherId,
    reason: req.body?.reason,
    evidenceReference: req.body?.evidenceReference,
    user: req.user,
    req
  });
  res.json({ data: voucher });
});
