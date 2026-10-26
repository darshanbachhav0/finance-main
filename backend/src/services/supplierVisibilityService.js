import CostCenter from "../models/CostCenter.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import SupplierBankAccount from "../models/SupplierBankAccount.js";
import User from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS, ROLES } from "../utils/constants.js";

// Suppliers by department. Every user belongs to one department, their area (User.area, set in
// Users or by the CECO / roster imports); someone nobody assigned one to is in "General". A new
// supplier belongs to the department of whoever registers it, and the Proveedores list of each
// user holds their department's suppliers, the older ones shared with every area (no department
// set) and the proposals they made themselves. Accounting, Treasury and Procurement are scoped like
// everyone else; only the Admin and the read-only Super Admin see every department.
//
// The same rule guards the list, the detail page, every change, the RUC lookup, global search, the
// invoice reader, supplier files and the supplier saved on a request, so it cannot be bypassed by
// calling the API directly. The exceptions are work someone must do on another department's
// supplier (seesSupplierThroughWork): it never puts that supplier in their list.

export const DEFAULT_DEPARTMENT = "General";
// Who sees the suppliers of every department.
export const SUPPLIER_OVERSIGHT_ROLES = Object.freeze([ROLES.ADMIN, ROLES.GAF, ROLES.SUPER_ADMIN, ROLES.AUDITOR]);
// Who processes every request once it is sent (invoice, purchase order, payment), so they open
// the supplier of any submitted request.
const REQUEST_PROCESSING_ROLES = Object.freeze([ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.PROCUREMENT]);

const idOf = (value) => String(value?._id || value || "");
const departmentKey = (value) => normalizeDepartment(value).toLocaleUpperCase("es");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalizeDepartment(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function userDepartment(user) {
  return normalizeDepartment(user?.area) || DEFAULT_DEPARTMENT;
}

export function isDepartmentScoped(user) {
  return Boolean(user) && !SUPPLIER_OVERSIGHT_ROLES.includes(user.role);
}

// A Mongo filter with the suppliers in this user's list, or {} for the Admin and Super Admin.
export function supplierVisibilityQuery(user) {
  if (!isDepartmentScoped(user)) return {};
  return {
    $or: [
      { departments: { $exists: false } },
      { departments: { $size: 0 } },
      { proposedBy: user._id },
      { departments: new RegExp(`^${escapeRegex(userDepartment(user))}$`, "i") }
    ]
  };
}

export function canSeeSupplier(supplier, user) {
  if (!supplier || !user) return false;
  if (!isDepartmentScoped(user)) return true;
  const departments = (supplier.departments || []).map(normalizeDepartment).filter(Boolean);
  if (!departments.length) return true;
  if (idOf(supplier.proposedBy) === idOf(user._id)) return true;
  const own = departmentKey(userDepartment(user));
  return departments.some((department) => departmentKey(department) === own);
}

// Work that opens another department's supplier without adding it to the user's list:
// - a request carrying it that the user raised or is an approver of;
// - Accounting, Treasury and Procurement: any submitted request carrying it (they register its
//   invoice, issue its order and pay it);
// - Accounting: one of its bank accounts waits for their verification.
// (Accounting's review of a proposal is checked by supplierService, which owns that rule.)
export async function seesSupplierThroughWork(supplier, user) {
  const supplierId = idOf(supplier);
  if (!supplierId || !user?._id) return false;
  const involved = [{ "approvalRouteSnapshot.approverUser": user._id }, { requester: user._id }, { solicitor: user._id }];
  if (REQUEST_PROCESSING_ROLES.includes(user.role)) involved.push({ status: { $ne: REQUEST_STATUS.DRAFT } });
  const onRequest = await FinancialRequest.exists({
    $and: [{ $or: [{ supplier: supplierId }, { "quotations.supplier": supplierId }] }, { $or: involved }]
  });
  if (onRequest) return true;
  return user.role === ROLES.ACCOUNTING
    && Boolean(await SupplierBankAccount.exists({ supplier: supplierId, active: true, verificationStatus: "PENDING" }));
}

export async function canOpenSupplier(supplier, user) {
  return canSeeSupplier(supplier, user) || seesSupplierThroughWork(supplier, user);
}

export async function assertCanOpenSupplier(supplier, user) {
  if (await canOpenSupplier(supplier, user)) return;
  throw new AppError(
    403,
    "This supplier belongs to another area. Ask an Admin to share it with your area.",
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
    "This supplier belongs to another area's list. Choose one of your area's suppliers, or ask an Admin to share it with your area.",
    { supplier: supplier._id, supplierCode: supplier.supplierCode, reason: "OTHER_DEPARTMENT" },
    ERROR_CODES.SUPPLIER_OTHER_DEPARTMENT
  );
}

// The departments a supplier can be shared with: every area a user or a CECO belongs to.
export async function listSupplierDepartments() {
  const [userAreas, centerAreas, supplierAreas] = await Promise.all([
    User.distinct("area", { active: true, role: { $ne: ROLES.SUPER_ADMIN } }),
    CostCenter.distinct("area", { active: true }),
    Supplier.distinct("departments")
  ]);
  const byKey = new Map();
  for (const value of [...userAreas, ...centerAreas, ...supplierAreas]) {
    const area = normalizeDepartment(value);
    if (!area || area === "*") continue;
    if (!byKey.has(departmentKey(area))) byKey.set(departmentKey(area), area);
  }
  return [...byKey.values()].sort((left, right) => left.localeCompare(right, "es"));
}

export function sanitizeDepartments(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" && value.trim().startsWith("[") ? JSON.parse(value) : String(value || "").split(",");
  const byKey = new Map();
  for (const item of list) {
    const area = normalizeDepartment(item);
    if (!area || area === "*") continue;
    if (area.length > 120) throw new AppError(422, "An area name is too long.", { field: "departments" }, ERROR_CODES.VALIDATION_ERROR);
    if (!byKey.has(departmentKey(area))) byKey.set(departmentKey(area), area);
  }
  return [...byKey.values()];
}
