import {
  Router
} from "express";

import {
  addBankAccount,
  createSupplier,
  decideApproval,
  deleteSupplier,
  getHomologationReadiness,
  getSupplier,
  listSuppliers,
  lookupSupplier,
  lookupSupplierPadron,
  lookupSupplierAssisted,
  lookupSupplierLegalRepresentatives,
  removeBankAccount,
  selectPreferredBankAccount,
  updateSupplier,
  updateSupplierProposalFields,
  validateTaxpayer,
  verifyBankAccount,
  listDepartments,
  updateDepartments,
  requestAccess
} from "../controllers/supplierController.js";

import {
  authorizePermission,
  protect
} from "../middleware/auth.js";

import {
  PERMISSIONS
} from "../utils/constants.js";

// Registering a supplier ("Dar de alta"): every role that holds supplier.create. Tesorería then
// validates it and its bank accounts before anything is paid to it.
const proposeSupplier = authorizePermission(PERMISSIONS.SUPPLIER_CREATE);
const validateSupplier = authorizePermission(PERMISSIONS.SUPPLIER_VALIDATE);

import {
  uploadFields
} from "../middleware/upload.js";

const router =
  Router();

router.use(
  protect,
  authorizePermission(PERMISSIONS.SUPPLIER_VIEW, PERMISSIONS.SUPPLIER_CREATE, PERMISSIONS.SUPPLIER_BANK_VIEW)
);

router.get(
  "/",
  listSuppliers
);

router.get(
  "/lookup/:identifier",
  lookupSupplier
);

// The areas a supplier can be shared with (must stay above /:id).
router.get(
  "/departments",
  listDepartments
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

router.post("/consulta-ruc/:ruc/assisted", proposeSupplier, lookupSupplierAssisted);

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

router.put(
  "/:id/departments",
  validateSupplier,
  updateDepartments
);

// A requester asks Tesorería to share another area's supplier with their area.
router.post(
  "/:id/access-request",
  proposeSupplier,
  requestAccess
);

router.post(
  "/:id/bank-accounts",
  proposeSupplier,
  addBankAccount
);

router.post(
  "/:id/bank-accounts/:accountId/verify",
  validateSupplier,
  verifyBankAccount
);

router.post(
  "/:id/bank-accounts/:accountId/preferred",
  validateSupplier,
  selectPreferredBankAccount
);

router.delete(
  "/:id/bank-accounts/:accountId",
  validateSupplier,
  removeBankAccount
);

router.post(
  "/:id/taxpayer-validation",
  validateSupplier,
  validateTaxpayer
);

// Only the proposer's jefe (or whoever covers for them; the Admin when nobody can) decides. The
// service resolves who that is from the roster, so the route is open to every supplier user.
router.post(
  "/:id/approval",
  decideApproval
);

router.put(
  "/:id",
  validateSupplier,
  uploadFields,
  updateSupplier
);

router.delete(
  "/:id",
  validateSupplier,
  deleteSupplier
);

export default router;
