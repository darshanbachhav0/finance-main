import { Router } from "express";
import { approveRequest, getApprovalInbox, observeRequest, rejectRequest, returnRequest } from "../controllers/approvalController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.APPROVER, ROLES.MANAGEMENT));
router.get("/inbox", getApprovalInbox);
router.post("/:id/approve", approveRequest);
router.post("/:id/observe", observeRequest);
router.post("/:id/return", returnRequest);
router.post("/:id/reject", rejectRequest);

export default router;
