import { asyncHandler } from "../middleware/asyncHandler.js";
import { bulkApproveRequests, decideApproval, getApprovalDecisionOptions, listApprovalInbox } from "../services/approvalService.js";
import { publicRequestPayload } from "../services/requestService.js";

export const getApprovalInbox = asyncHandler(async (req, res) => {
  res.json(await listApprovalInbox(req.query, req.user));
});

export const getApprovalOptions = asyncHandler(async (req, res) => {
  res.json({ data: await getApprovalDecisionOptions(req.params.id, req.user) });
});

function decisionHandler(action) {
  return asyncHandler(async (req, res) => {
    const result = await decideApproval({
      id: req.params.id,
      action,
      comments: req.body.comments,
      adminOverrideReason: req.body.adminOverrideReason,
      forward: action === "APPROVE" ? req.body.forward : undefined,
      user: req.user,
      req
    });
    res.json({ data: publicRequestPayload(result.request, req.user), warning: result.budgetWarning });
  });
}

// Per-request outcomes are always 200: a partial failure is a normal result the
// inbox summarizes ("8 approved, 2 with errors"), not a failed call.
export const bulkApproveRequestsHandler = asyncHandler(async (req, res) => {
  const data = await bulkApproveRequests({
    ids: req.body.ids,
    comments: req.body.comments,
    forward: req.body.forward,
    user: req.user,
    req
  });
  res.json({ data });
});

export const approveRequest = decisionHandler("APPROVE");
export const observeRequest = decisionHandler("OBSERVE");
export const returnRequest = decisionHandler("RETURN");
export const rejectRequest = decisionHandler("REJECT");
