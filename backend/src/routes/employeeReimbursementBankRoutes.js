import { Router } from "express";
import {
  createAccount,
  deactivateAccount,
  listAccounts,
  reviewAccount,
  selectPreferred,
  updateAccount
} from "../controllers/employeeReimbursementBankController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect);
router.get("/", authorize(ROLES.ADMIN, ROLES.SOLICITOR, ROLES.ACCOUNTING, ROLES.TREASURY), listAccounts);
router.post("/", authorize(ROLES.ADMIN, ROLES.SOLICITOR), createAccount);
router.patch("/:id", authorize(ROLES.ADMIN, ROLES.SOLICITOR), updateAccount);
router.post("/:id/preferred", authorize(ROLES.ADMIN, ROLES.SOLICITOR), selectPreferred);
router.post("/:id/review", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), reviewAccount);
router.delete("/:id", authorize(ROLES.ADMIN, ROLES.SOLICITOR), deactivateAccount);

export default router;
