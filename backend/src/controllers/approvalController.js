import { asyncHandler } from "../middleware/asyncHandler.js";
import { decideApproval, listApprovalInbox } from "../services/approvalService.js";
import { publicRequestPayload } from "../services/requestService.js";

export const getApprovalInbox = asyncHandler(async (req, res) => {
  res.json(await listApprovalInbox(req.query, req.user));
});

function decisionHandler(action) {
  return asyncHandler(async (req, res) => {
    const result = await decideApproval({
      id: req.params.id,
      action,
      comments: req.body.comments,
      adminOverrideReason: req.body.adminOverrideReason,
      user: req.user,
      req
    });
    res.json({ data: publicRequestPayload(result.request), warning: result.budgetWarning });
  });
}

export const approveRequest = decisionHandler("APPROVE");
export const observeRequest = decisionHandler("OBSERVE");
export const returnRequest = decisionHandler("RETURN");
export const rejectRequest = decisionHandler("REJECT");
