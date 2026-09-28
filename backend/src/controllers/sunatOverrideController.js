import { approveManualSunatException } from "../services/invoiceRegistrationService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

// Dedicated, separately-authorized manual SUNAT exception (Admin/Accounting only - see
// sunatOverrideRoutes.js). It is never part of the automatic validation path: one Accounting user
// records a mandatory reason (evidence reference optional), the voucher is marked with the explicit
// non-authoritative MANUAL_EXCEPTION status, and the decision is audited. The invoice is then
// posted when possible (see approveManualSunatException).
export const manualSunatOverride = asyncHandler(async (req, res) => {
  const result = await approveManualSunatException({
    requestId: req.params.id,
    voucherId: req.params.voucherId,
    reason: req.body?.reason,
    evidenceReference: req.body?.evidenceReference,
    user: req.user,
    req
  });
  res.json({ data: result.voucher, provisioned: result.provisioned, accountsPayable: result.accountsPayable, supplierCredit: result.supplierCredit, detail: result.detail });
});
