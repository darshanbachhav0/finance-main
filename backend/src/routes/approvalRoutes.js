import { Router } from "express";
import { approveRequest, getApprovalInbox, observeRequest, rejectRequest, returnRequest } from "../controllers/approvalController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

// Solicitor is included because manager-chain approvers (imported from the
// org roster) are ordinary employees with no special role — who can actually
// act on a given request is enforced downstream by identity (assertApprovalActor
// / isActiveChainApprover), not by this role gate.
router.use(protect, authorize(ROLES.ADMIN, ROLES.APPROVER, ROLES.MANAGEMENT, ROLES.SOLICITOR));
router.get("/inbox", getApprovalInbox);
router.post("/:id/approve", approveRequest);
router.post("/:id/observe", observeRequest);
router.post("/:id/return", returnRequest);
router.post("/:id/reject", rejectRequest);

export default router;
