import { Router } from "express";
import { approveRequest, bulkApproveRequestsHandler, getApprovalInbox, getApprovalOptions, observeRequest, rejectRequest, returnRequest } from "../controllers/approvalController.js";
import { authorize, protect } from "../middleware/auth.js";
import { CANONICAL_ROLES, ROLES } from "../utils/constants.js";

const router = Router();

// Solicitor is included because manager-chain approvers (imported from the
// org roster) are ordinary employees with no special role — who can actually
// act on a given request is enforced downstream by identity (assertApprovalActor
// / isActiveChainApprover), not by this role gate.
// Auditoría never approves. Everyone else reaches the inbox, which lists only the steps assigned
// to them; the administrator approves nothing for being administrator.
router.use(protect, authorize(...CANONICAL_ROLES.filter((role) => role !== ROLES.AUDITOR)));
router.get("/inbox", getApprovalInbox);
// Declared before the /:id routes. Approve only; each request is still decided by decideApproval.
router.post("/bulk", bulkApproveRequestsHandler);
router.get("/:id/options", getApprovalOptions);
router.post("/:id/approve", approveRequest);
router.post("/:id/observe", observeRequest);
router.post("/:id/return", returnRequest);
router.post("/:id/reject", rejectRequest);

export default router;
