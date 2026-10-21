import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { SUPPLIER_WORK_ROLES } from "../utils/permissions.js";

// Suppliers by area. A requester (anyone outside the supplier work roles: Admin, Accounting,
// Treasury, Procurement, Super Admin) sees the suppliers of their own area (User.area), the ones
// shared with every area (no area set) and the proposals they made themselves. The same rule
// guards the list, the detail page, the RUC lookup, global search, the invoice reader and the
// supplier saved on a request, so it cannot be bypassed by calling the API directly.

// "General" is the default area of a user nobody assigned one to: it is not an area.
const UNASSIGNED_AREAS = new Set(["", "GENERAL"]);

const idOf = (value) => String(value?._id || value || "");

export function normalizeDepartment(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function userDepartment(user) {
  const area = normalizeDepartment(user?.area);
  return UNASSIGNED_AREAS.has(area.toUpperCase()) ? "" : area;
}

export function isDepartmentScoped(user) {
  return Boolean(user) && !SUPPLIER_WORK_ROLES.includes(user.role);
}

const sameDepartment = (left, right) => normalizeDepartment(left).toLocaleUpperCase("es") === normalizeDepartment(right).toLocaleUpperCase("es");

// A Mongo filter with the suppliers this user may see, or {} for the supplier work roles.
export function supplierVisibilityQuery(user) {
  if (!isDepartmentScoped(user)) return {};
  const area = userDepartment(user);
  const visible = [{ departments: { $exists: false } }, { departments: { $size: 0 } }, { proposedBy: user._id }];
  if (area) visible.push({ departments: new RegExp(`^${area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  return { $or: visible };
}

export function canSeeSupplier(supplier, user) {
  if (!supplier) return false;
  if (!isDepartmentScoped(user)) return true;
  const departments = (supplier.departments || []).map(normalizeDepartment).filter(Boolean);
  if (!departments.length) return true;
  if (idOf(supplier.proposedBy) === idOf(user._id)) return true;
  const area = userDepartment(user);
  return Boolean(area) && departments.some((department) => sameDepartment(department, area));
}

// Who decides on a request may open its supplier even when it is another area's: an approver on
// the request's route, or the requester of a request that already carries it.
export async function seesSupplierThroughRequest(supplierId, user) {
  if (!supplierId || !user?._id) return false;
  return Boolean(await FinancialRequest.exists({
    $and: [
      { $or: [{ supplier: supplierId }, { "quotations.supplier": supplierId }] },
      { $or: [{ "approvalRouteSnapshot.approverUser": user._id }, { requester: user._id }, { solicitor: user._id }] }
    ]
  }));
}

export async function assertCanOpenSupplier(supplier, user) {
  if (canSeeSupplier(supplier, user)) return;
  if (await seesSupplierThroughRequest(supplier._id, user)) return;
  throw new AppError(
    403,
    "This supplier belongs to another area. Ask Accounting or an Admin to share it with your area.",
    { supplier: supplier._id, supplierCode: supplier.supplierCode, reason: "OTHER_DEPARTMENT" },
    ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT
  );
}

// The supplier a requester puts on a request (and every quoted supplier) must be on their list.
// A supplier already saved on this request stays usable, so an older draft is never locked.
export function assertSupplierSelectable(supplier, user, { alreadyOnRequest = false } = {}) {
  if (!supplier || alreadyOnRequest || canSeeSupplier(supplier, user)) return;
  throw new AppError(
    403,
    "This supplier belongs to another area's list. Choose one of your area's suppliers, or ask Accounting or an Admin to share it with your area.",
    { supplier: supplier._id, supplierCode: supplier.supplierCode, reason: "OTHER_DEPARTMENT" },
    ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT
  );
}

// The areas a supplier can be assigned to: every area a user or a CECO belongs to.
export async function listSupplierDepartments() {
  const [userAreas, centerAreas, supplierAreas] = await Promise.all([
    User.distinct("area", { active: true }),
    CostCenter.distinct("area", { active: true }),
    Supplier.distinct("departments")
  ]);
  const byKey = new Map();
  for (const value of [...userAreas, ...centerAreas, ...supplierAreas]) {
    const area = normalizeDepartment(value);
    if (!area || UNASSIGNED_AREAS.has(area.toUpperCase()) || area === "*") continue;
    const key = area.toLocaleUpperCase("es");
    if (!byKey.has(key)) byKey.set(key, area);
  }
  return [...byKey.values()].sort((left, right) => left.localeCompare(right, "es"));
}

export function sanitizeDepartments(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" && value.trim().startsWith("[") ? JSON.parse(value) : String(value || "").split(",");
  const byKey = new Map();
  for (const item of list) {
    const area = normalizeDepartment(item);
    if (!area || UNASSIGNED_AREAS.has(area.toUpperCase())) continue;
    if (area.length > 120) throw new AppError(422, "An area name is too long.", { field: "departments" }, ERROR_CODES.VALIDATION_ERROR);
    byKey.set(area.toLocaleUpperCase("es"), area);
  }
  return [...byKey.values()];
}
