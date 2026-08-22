import {
  Router
} from "express";

import {
  addBankAccount,
  createSupplier,
  deleteSupplier,
  getHomologationReadiness,
  getSupplier,
  homologate,
  listSuppliers,
  lookupSupplier,
  lookupSupplierPadron,
  removeBankAccount,
  reviewSupplier,
  selectPreferredBankAccount,
  updateSupplier,
  updateSupplierProposalFields,
  validateTaxpayer,
  verifyBankAccount
} from "../controllers/supplierController.js";

import {
  authorize,
  protect
} from "../middleware/auth.js";

import {
  ROLES
} from "../utils/constants.js";

import {
  SUPPLIER_VIEW_ROLES
} from "../utils/permissions.js";

import {
  uploadFields
} from "../middleware/upload.js";

const router =
  Router();

router.use(
  protect,
  authorize(
    ...SUPPLIER_VIEW_ROLES
  )
);

router.get(
  "/",
  listSuppliers
);

router.get(
  "/lookup/:identifier",
  lookupSupplier
);

/*
 * Important:
 * This route must remain ABOVE /:id.
 */
router.get(
  "/padron/:ruc",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING,
    ROLES.SOLICITOR
  ),
  lookupSupplierPadron
);

router.post(
  "/",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING,
    ROLES.SOLICITOR
  ),
  uploadFields,
  createSupplier
);

router.get(
  "/:id",
  getSupplier
);

router.get(
  "/:id/homologation-readiness",
  getHomologationReadiness
);

router.patch(
  "/:id/proposal",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING,
    ROLES.SOLICITOR
  ),
  uploadFields,
  updateSupplierProposalFields
);

router.post(
  "/:id/bank-accounts",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING,
    ROLES.SOLICITOR
  ),
  addBankAccount
);

router.post(
  "/:id/bank-accounts/:accountId/verify",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  verifyBankAccount
);

router.post(
  "/:id/bank-accounts/:accountId/preferred",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  selectPreferredBankAccount
);

router.delete(
  "/:id/bank-accounts/:accountId",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  removeBankAccount
);

router.post(
  "/:id/taxpayer-validation",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  validateTaxpayer
);

router.post(
  "/:id/review",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  reviewSupplier
);

router.post(
  "/:id/homologate",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  homologate
);

router.put(
  "/:id",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  uploadFields,
  updateSupplier
);

router.delete(
  "/:id",
  authorize(
    ROLES.ADMIN,
    ROLES.ACCOUNTING
  ),
  deleteSupplier
);

export default router;