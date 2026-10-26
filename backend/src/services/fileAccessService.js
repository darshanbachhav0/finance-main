import path from "path";
import FinancialRequest from "../models/FinancialRequest.js";
import PaymentBatch from "../models/PaymentBatch.js";
import Supplier from "../models/Supplier.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, PERMISSIONS, ROLES } from "../utils/constants.js";
import { SUPPLIER_WORK_ROLES, canViewRequest, canViewSuppliers, hasPermission } from "../utils/permissions.js";
import { generatedRoot, uploadRoot } from "./storageService.js";
import { isCurrentSupplierApprover } from "./supplierService.js";
import { SUPPLIER_OVERSIGHT_ROLES, canOpenSupplier } from "./supplierVisibilityService.js";
import { assertBankFileReleased } from "../utils/bankFileVerification.js";

// The Super Admin and the Auditor read what an Admin reads; an unverified bank file stays closed
// to them (they do not hold bank-file:verify). The GAF verifies bank files and reads reports.
const generatedAccess = Object.freeze({
  "bank-files": [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF, ROLES.SUPER_ADMIN, ROLES.AUDITOR],
  reports: [ROLES.ADMIN, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.MANAGEMENT, ROLES.GAF, ROLES.SUPER_ADMIN, ROLES.AUDITOR],
  accounting: [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.SUPER_ADMIN, ROLES.AUDITOR]
});

function forbidden(message = "You do not have permission to access this file.") {
  return new AppError(403, message, undefined, ERROR_CODES.FORBIDDEN);
}

export function resolveStoredAsset(resourcePath) {
  const normalized = String(resourcePath || "").trim().replace(/\\/g, "/").split(/[?#]/, 1)[0];
  const definition = normalized.startsWith("/uploads/")
    ? { kind: "uploads", root: uploadRoot, relative: normalized.slice("/uploads/".length) }
    : normalized.startsWith("/generated/")
      ? { kind: "generated", root: generatedRoot, relative: normalized.slice("/generated/".length) }
      : null;
  if (!definition) throw new AppError(400, "Unsupported stored-file path.", undefined, ERROR_CODES.VALIDATION_ERROR);

  const segments = definition.relative.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) || segment === "." || segment === "..")) {
    throw new AppError(400, "Invalid stored-file path.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  const absolutePath = path.resolve(definition.root, ...segments);
  const rootPrefix = `${path.resolve(definition.root)}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new AppError(400, "Invalid stored-file path.", undefined, ERROR_CODES.VALIDATION_ERROR);
  }
  return { ...definition, segments, absolutePath };
}

export async function assertStoredAssetAccess(asset, user, { requestId } = {}) {
  if (asset.kind === "uploads" && asset.segments[0] === "requests") {
    // The approval route is loaded too: a chain approver who can open the request can open its files.
    const request = await FinancialRequest.findById(asset.segments[1]).select("requester solicitor status approvalRouteSnapshot.approverUser costCenterReviewers");
    if (!request || !canViewRequest(request, user)) throw forbidden();
    return;
  }
  if (asset.kind === "uploads" && asset.segments[0] === "suppliers") {
    // Supplier evidence may be inspected from its request by the assigned approver,
    // without granting access to unrelated suppliers or their files.
    if (requestId) {
      const request = await FinancialRequest.findById(requestId).select("supplier requester solicitor status requesterArea requestingArea approvalRouteSnapshot.approverUser");
      const assigned = request?.approvalRouteSnapshot?.some(step => String(step.approverUser) === String(user._id));
      const areas = [user.area, ...(user.approvalAreas || [])];
      const poolApprover = [ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR].includes(user.role) && (areas.includes("*") || areas.includes(request?.requesterArea || request?.requestingArea));
      if (request && String(request.supplier) === asset.segments[1] && canViewRequest(request, user) && (assigned || poolApprover)) return;
    }
    if (!canViewSuppliers(user)) throw forbidden();
    if (SUPPLIER_OVERSIGHT_ROLES.includes(user.role)) return;
    const supplier = await Supplier.findById(asset.segments[1]).select("proposedBy departments homologationStatus homologationValidUntil");
    if (!supplier) throw forbidden();
    // Accounting reviewing the proposal opens its evidence whatever the department.
    if (await isCurrentSupplierApprover(supplier, user)) return;
    if (SUPPLIER_WORK_ROLES.includes(user.role) || hasPermission(user, PERMISSIONS.SUPPLIER_BANK_VIEW)) {
      // Finance staff: the suppliers they can open (their department's, or one their work reaches).
      if (!(await canOpenSupplier(supplier, user))) throw forbidden();
      return;
    }
    // Everyone else: the proposer while the proposal is open.
    const proposerOpen = String(supplier.proposedBy || "") === String(user._id) && ["PENDING_VALIDATION", "OBSERVED"].includes(supplier.homologationStatus);
    if (!proposerOpen) throw forbidden();
    return;
  }
  if (asset.kind === "generated") {
    const roles = generatedAccess[asset.segments[0]];
    // Report files follow "View reports" (role default or granted), like the reports screen.
    const allowed = asset.segments[0] === "reports" ? hasPermission(user, PERMISSIONS.REPORT_VIEW) : roles?.includes(user.role);
    if (!allowed) throw forbidden();
    if (asset.segments[0] === "bank-files") return bankFileAccess(asset, user);
    return;
  }
  throw forbidden();
}

// A bank TXT reaches Treasury only once Accounting has verified it; Accounting (and Admin) open it
// at any time to review it. Every download is checked against the checksum recorded at generation,
// so what is downloaded is exactly the file that was generated and verified.
async function bankFileAccess(asset, user) {
  const batch = await PaymentBatch.findOne({ url: `/generated/${asset.segments.join("/")}` }).select("batchNumber checksum verification").lean();
  if (!batch) return;
  if (!hasPermission(user, PERMISSIONS.BANK_FILE_VERIFY)) assertBankFileReleased(batch, "download");
  return { checksum: batch.checksum };
}
