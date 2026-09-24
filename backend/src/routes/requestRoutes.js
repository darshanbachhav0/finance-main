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
  settleRenditionBalance,
  submitRequest,
  updateRequest,
  uploadRendition,
  validateRendition,
  voidRequest,
} from "../controllers/requestController.js";
import { authorize, protect } from "../middleware/auth.js";
import { uploadFields } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";
import { REQUEST_CREATOR_ROLES } from "../utils/permissions.js";

const router = Router();

router.use(protect);
router.get("/document-requirements", getRequestDocumentRequirements);
router.get("/form-policy", getRequestFormPolicy);
router.get("/authorized-cost-centers", authorize(...REQUEST_CREATOR_ROLES), getAuthorizedCostCenters);
router.post("/budget-preview", authorize(...REQUEST_CREATOR_ROLES), getBudgetPreview);
router.route("/").get(listRequests).post(authorize(...REQUEST_CREATOR_ROLES), uploadFields, createRequest);
router.get("/:id/document-requirements", getRequestDocumentStatus);
router.route("/:id").get(getRequest).put(uploadFields, updateRequest).delete(deleteRequest);
router.get("/:id/procurement-readiness", getProcurementReadiness);
router.post("/:id/procurement-order", authorize(ROLES.ADMIN, ROLES.PROCUREMENT), createProcurementOrder);
router.post("/:id/submit", submitRequest);
router.post("/:id/invoice", authorize(ROLES.ADMIN, ROLES.SOLICITOR, ROLES.ACCOUNTING), uploadFields, registerInvoice);
router.post("/:id/rendition", authorize(ROLES.ADMIN, ROLES.SOLICITOR), uploadFields, uploadRendition);
router.get("/:id/rendition/policy", getRenditionFormPolicy);
router.get("/:id/rendition/bank-destination", getRenditionPaymentDestination);
router.post("/:id/rendition/approve", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), approveRendition);
router.post("/:id/rendition/validate", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), validateRendition);
router.post("/:id/rendition/observe", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), observeRendition);
router.post("/:id/rendition/reject", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), rejectRendition);
router.post("/:id/rendition/recover", authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY), recoverRendition);
router.post("/:id/rendition/settle-non-deductible", authorize(ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY), settleRenditionBalance);
router.post("/:id/close", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), closeRequest);
router.post("/:id/void", authorize(ROLES.ADMIN, ROLES.ACCOUNTING), voidRequest);

export default router;
