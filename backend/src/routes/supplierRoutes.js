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
  lookupSupplierLegalRepresentatives,
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
  authorizeAccess,
  protect
} from "../middleware/auth.js";

import {
  PERMISSIONS,
  ROLES
} from "../utils/constants.js";

// Proposing a supplier: Accounting/Admin by role, every Solicitor and anyone granted
// "Propose suppliers" by permission.
const proposeSupplier = authorizeAccess({ roles: [ROLES.ADMIN, ROLES.ACCOUNTING], permissions: [PERMISSIONS.SUPPLIER_PROPOSE] });

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
  authorizeAccess({
    roles: SUPPLIER_VIEW_ROLES,
    permissions: [PERMISSIONS.SUPPLIER_PROPOSE, PERMISSIONS.SUPPLIER_BANK_VIEW]
  })
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
 * These two routes MUST remain above /:id.
 */
router.get(
  "/padron/:ruc",
  proposeSupplier,
  lookupSupplierPadron
);

router.get(
  "/consulta-ruc/:ruc/representatives",
  proposeSupplier,
  lookupSupplierLegalRepresentatives
);

router.post(
  "/",
  proposeSupplier,
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
  proposeSupplier,
  uploadFields,
  updateSupplierProposalFields
);

router.post(
  "/:id/bank-accounts",
  proposeSupplier,
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