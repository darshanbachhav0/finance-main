import path from "path";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { canViewRequest, canViewSuppliers } from "../utils/permissions.js";
import { generatedRoot, uploadRoot } from "./storageService.js";

const generatedAccess = Object.freeze({
  "bank-files": [ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.TREASURY],
  reports: [ROLES.ADMIN, ROLES.APPROVER, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.BUDGET, ROLES.MANAGEMENT],
  accounting: [ROLES.ADMIN, ROLES.ACCOUNTING]
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

export async function assertStoredAssetAccess(asset, user) {
  if (asset.kind === "uploads" && asset.segments[0] === "requests") {
    const request = await FinancialRequest.findById(asset.segments[1]).select("requester solicitor status");
    if (!request || !canViewRequest(request, user)) throw forbidden();
    return;
  }
  if (asset.kind === "uploads" && asset.segments[0] === "suppliers") {
    if (!canViewSuppliers(user.role)) throw forbidden();
    if (user.role === ROLES.SOLICITOR) {
      const supplier = await Supplier.findById(asset.segments[1]).select("proposedBy homologationStatus");
      if (!supplier || String(supplier.proposedBy || "") !== String(user._id) || !["PENDING_VALIDATION", "OBSERVED"].includes(supplier.homologationStatus)) {
        throw forbidden();
      }
    }
    return;
  }
  if (asset.kind === "generated") {
    const roles = generatedAccess[asset.segments[0]];
    if (!roles?.includes(user.role)) throw forbidden();
    return;
  }
  throw forbidden();
}
