import { Router } from "express";
import {
  createAccount,
  deactivateAccount,
  listAccounts,
  reviewAccount,
  selectPreferred,
  updateAccount
} from "../controllers/employeeReimbursementBankController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();

router.use(protect);
const manageOwn = authorizePermission(PERMISSIONS.EMPLOYEE_BANK_MANAGE_OWN);
router.get("/", authorizePermission(PERMISSIONS.EMPLOYEE_BANK_MANAGE_OWN, PERMISSIONS.EMPLOYEE_BANK_REVIEW, PERMISSIONS.EMPLOYEE_BANK_VIEW_PAYMENT), listAccounts);
router.post("/", manageOwn, createAccount);
router.patch("/:id", manageOwn, updateAccount);
router.post("/:id/preferred", manageOwn, selectPreferred);
router.post("/:id/review", authorizePermission(PERMISSIONS.EMPLOYEE_BANK_REVIEW), reviewAccount);
router.delete("/:id", manageOwn, deactivateAccount);

export default router;
