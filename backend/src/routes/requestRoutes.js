import { Router } from "express";
import {
  closeRequest,
  approveRendition,
  createProcurementOrder,
  createRequest,
  deleteRequest,
  getAuthorizedCostCenters,
  getBudgetPreview,
  getProcurementReadiness,
  getRequestDocumentRequirements,
  getRequestDocumentStatus,
  getRequestFormPolicy,
  getRenditionFormPolicy,
  getRenditionPaymentDestination,
  getRequest,
  listRequests,
  observeRendition,
  recoverRendition,
  rejectRendition,
  registerInvoice,
  replaceObservedInvoice,
  settleRenditionBalance,
  submitRequest,
  updateRequest,
  uploadRendition,
  validateRendition,
  voidRequest,
  withdrawRequest,
} from "../controllers/requestController.js";
import { authorize, authorizeAccess, authorizePermission, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { PERMISSIONS, ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect);
router.get("/document-requirements", getRequestDocumentRequirements);
router.get("/form-policy", getRequestFormPolicy);
// "Create requests" (every Solicitor and Admin by role, anyone else by grant).
router.get("/authorized-cost-centers", authorizePermission(PERMISSIONS.REQUEST_CREATE), getAuthorizedCostCenters);
router.post("/budget-preview", authorizePermission(PERMISSIONS.REQUEST_CREATE), getBudgetPreview);
router.route("/").get(listRequests).post(authorizePermission(PERMISSIONS.REQUEST_CREATE), uploadFields, createRequest);
router.get("/:id/document-requirements", getRequestDocumentStatus);
router.route("/:id").get(getRequest).put(uploadFields, updateRequest).delete(deleteRequest);
router.get("/:id/procurement-readiness", getProcurementReadiness);
router.post("/:id/procurement-order", authorizePermission(PERMISSIONS.PROCUREMENT_ORDER_CREATE), createProcurementOrder);
router.post("/:id/submit", submitRequest);
router.post("/:id/withdraw", withdrawRequest);
router.post("/:id/invoice", authorizeAccess({ roles: [ROLES.ADMIN, ROLES.ACCOUNTING], permissions: [PERMISSIONS.REQUEST_CREATE] }), uploadFields, registerInvoice);
router.post("/:id/invoice/:voucherId/replace", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), replaceObservedInvoice);
router.post("/:id/rendition", authorizePermission(PERMISSIONS.REQUEST_CREATE), uploadFields, uploadRendition);
router.get("/:id/rendition/policy", getRenditionFormPolicy);
router.get("/:id/rendition/bank-destination", getRenditionPaymentDestination);
router.post("/:id/rendition/approve", authorizePermission(PERMISSIONS.RENDITION_REVIEW), approveRendition);
router.post("/:id/rendition/validate", authorizePermission(PERMISSIONS.RENDITION_REVIEW), validateRendition);
router.post("/:id/rendition/observe", authorizePermission(PERMISSIONS.RENDITION_REVIEW), observeRendition);
router.post("/:id/rendition/reject", authorizePermission(PERMISSIONS.RENDITION_REVIEW), rejectRendition);
router.post("/:id/rendition/recover", authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY), recoverRendition);
router.post("/:id/rendition/settle-non-deductible", authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY), settleRenditionBalance);
router.post("/:id/close", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), closeRequest);
router.post("/:id/void", authorizePermission(PERMISSIONS.REQUEST_VOID), voidRequest);

export default router;
