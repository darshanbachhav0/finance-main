import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import SunatVoucher from "../models/SunatVoucher.js";
import Supplier from "../models/Supplier.js";
import User from "../models/User.js";
import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { escapedRegex } from "./queryService.js";
import { ROLES } from "../utils/constants.js";
import { canViewSuppliers, requestVisibilityFilter } from "../utils/permissions.js";
import { seriesNumberPattern, voucherNumberPattern } from "../utils/voucherIdentity.js";

// Global search (Ctrl+K). Each group reuses the visibility rule of the list endpoint that opens
// the record, so a result never points at something the caller could not open:
//   requests  - requestVisibilityFilter (the /requests list rule)
//   vouchers  - the parent request's requestVisibilityFilter (vouchers are read in Request Detail)
//   suppliers - SUPPLIER_VIEW_ROLES (the /suppliers route gate)
//   payables  - Admin and Accounting (the /accounting route gate)
//   users     - Admin (the /users route gate)
// ManagementViewer is refused by the internal API gate and, should this service be reached
// another way, gets no group at all.
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
export const SEARCH_GROUP_LIMIT = 5;

const INTERNAL_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SOLICITOR, ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.BUDGET, ROLES.PROCUREMENT, ROLES.MANAGEMENT]);
const PAYABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.ACCOUNTING]);
const USER_ROLES = Object.freeze([ROLES.ADMIN]);

export const SEARCH_GROUPS = Object.freeze(["requests", "suppliers", "vouchers", "payables", "users"]);

export function searchGroupsFor(user) {
  if (!user || user.active === false || !INTERNAL_ROLES.includes(user.role)) return [];
  return SEARCH_GROUPS.filter((group) => {
    if (group === "suppliers") return canViewSuppliers(user);
    if (group === "payables") return PAYABLE_ROLES.includes(user.role);
    if (group === "users") return USER_ROLES.includes(user.role);
    return true;
  });
}

export function normalizeSearchTerm(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
}

// "F001-123" also finds F001-00000123: the correlative is compared without leading zeros.
function seriesNumberParts(term) {
  const match = /^([A-Z0-9]{1,4})\s*-\s*([A-Z0-9]{1,20})$/i.exec(term);
  return match ? { series: match[1], number: match[2] } : null;
}

// Prefixes every field of a Mongo filter so it applies to a $lookup-ed document.
function prefixFilter(filter, prefix) {
  if (Array.isArray(filter)) return filter.map((item) => prefixFilter(item, prefix));
  return Object.fromEntries(Object.entries(filter).map(([key, value]) => (key.startsWith("$")
    ? [key, prefixFilter(value, prefix)]
    : [`${prefix}.${key}`, value])));
}

const supplierLabel = (supplier) => supplier?.legalName || supplier?.name || "";

async function searchRequests(term, search, user) {
  const supplierIds = await Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { commercialName: search }, { rucDni: search }, { normalizedIdentifier: search }, { supplierCode: search }] });
  const rows = await FinancialRequest.find({ $and: [requestVisibilityFilter(user), { $or: [
    { requestNumber: search },
    { areaCorrelative: search },
    { title: search },
    { "supplierSnapshot.legalName": search },
    { "supplierSnapshot.identifier": search },
    { supplier: { $in: supplierIds } }
  ] }] })
    .select("requestNumber title status totalAmount currency supplier supplierSnapshot flowType")
    .populate("supplier", "name legalName rucDni")
    .sort({ updatedAt: -1 })
    .limit(SEARCH_GROUP_LIMIT)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    path: `/requests/${row._id}`,
    title: row.requestNumber,
    description: row.title || "",
    supplierName: supplierLabel(row.supplier) || row.supplierSnapshot?.legalName || "",
    amount: row.totalAmount ?? 0,
    currency: row.currency || "PEN",
    status: canonicalRequestStatus(row.status)
  }));
}

async function searchSuppliers(term, search) {
  const rows = await Supplier.find({ $or: [{ supplierCode: search }, { rucDni: search }, { normalizedIdentifier: search }, { legalName: search }, { commercialName: search }, { name: search }] })
    .select("supplierCode rucDni legalName commercialName name homologationStatus active")
    .sort({ legalName: 1, name: 1 })
    .limit(SEARCH_GROUP_LIMIT)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    path: `/suppliers?record=${row._id}`,
    title: supplierLabel(row),
    commercialName: row.commercialName && row.commercialName !== supplierLabel(row) ? row.commercialName : "",
    ruc: row.rucDni,
    code: row.supplierCode || "",
    status: row.homologationStatus,
    active: row.active !== false
  }));
}

async function searchVouchers(term, search, user) {
  const parts = seriesNumberParts(term);
  const match = { $or: [{ seriesNumber: search }, { series: search }, { number: search }, { rucIssuer: search }] };
  if (parts) match.$or.push({ seriesNumber: seriesNumberPattern(parts.series, parts.number) });
  const rows = await SunatVoucher.aggregate([
    { $match: match },
    { $sort: { updatedAt: -1 } },
    { $lookup: { from: FinancialRequest.collection.name, localField: "request", foreignField: "_id", as: "parentRequest" } },
    { $unwind: "$parentRequest" },
    { $match: prefixFilter(requestVisibilityFilter(user), "parentRequest") },
    { $limit: SEARCH_GROUP_LIMIT },
    { $project: { seriesNumber: 1, voucherType: 1, rucIssuer: 1, xmlAmount: 1, currency: 1, validationStatus: 1, "parentRequest._id": 1, "parentRequest.requestNumber": 1, "parentRequest.currency": 1 } }
  ]);
  return rows.map((row) => ({
    id: String(row._id),
    path: `/requests/${row.parentRequest._id}`,
    title: row.seriesNumber,
    voucherType: row.voucherType,
    ruc: row.rucIssuer,
    requestNumber: row.parentRequest.requestNumber,
    amount: row.xmlAmount ?? 0,
    currency: row.currency || row.parentRequest.currency || "PEN",
    status: row.validationStatus
  }));
}

async function searchPayables(term, search) {
  const parts = seriesNumberParts(term);
  const [requestIds, supplierIds] = await Promise.all([
    FinancialRequest.distinct("_id", { requestNumber: search }),
    Supplier.distinct("_id", { $or: [{ legalName: search }, { name: search }, { rucDni: search }, { normalizedIdentifier: search }] })
  ]);
  const conditions = [
    { "voucher.series": search },
    { "voucher.number": search },
    { supplierIdentifierSnapshot: search },
    { request: { $in: requestIds } },
    { supplier: { $in: supplierIds } }
  ];
  if (parts) conditions.push({ "voucher.series": new RegExp(`^${escapedRegex(parts.series)}$`, "i"), "voucher.number": voucherNumberPattern(parts.number) });
  const rows = await AccountsPayable.find({ $or: conditions })
    .select("request supplier voucher outstandingAmount originalAmount currency status beneficiarySnapshot.name")
    .populate("request", "requestNumber")
    .populate("supplier", "name legalName")
    .sort({ updatedAt: -1 })
    .limit(SEARCH_GROUP_LIMIT)
    .lean();
  return rows.map((row) => {
    const voucher = row.voucher?.series && row.voucher?.number ? `${row.voucher.series}-${row.voucher.number}` : "";
    return {
      id: String(row._id),
      path: `/accounting/payables?record=${row._id}`,
      title: voucher || row.request?.requestNumber || String(row._id),
      voucher,
      requestNumber: row.request?.requestNumber || "",
      supplierName: supplierLabel(row.supplier) || row.beneficiarySnapshot?.name || "",
      amount: row.outstandingAmount ?? row.originalAmount ?? 0,
      currency: row.currency || "PEN",
      status: row.status
    };
  });
}

async function searchUsers(term, search) {
  const rows = await User.find({ $or: [{ name: search }, { dni: search }, { email: search }, { employeeCode: search }] })
    .select("name dni email employeeCode role active")
    .sort({ active: -1, name: 1 })
    .limit(SEARCH_GROUP_LIMIT)
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    // The Users screen has no single-record link; it opens filtered by this identifier.
    path: "/users",
    filter: row.dni || row.email || row.name,
    title: row.name,
    dni: row.dni || "",
    email: row.email || "",
    role: row.role,
    active: row.active !== false
  }));
}

const SEARCHERS = { requests: searchRequests, suppliers: searchSuppliers, vouchers: searchVouchers, payables: searchPayables, users: searchUsers };

export async function globalSearch(rawTerm, user) {
  const query = normalizeSearchTerm(rawTerm);
  const base = { query, minLength: SEARCH_MIN_LENGTH, limit: SEARCH_GROUP_LIMIT };
  const allowed = searchGroupsFor(user);
  if (query.length < SEARCH_MIN_LENGTH || !allowed.length) return { ...base, groups: [] };
  const search = new RegExp(escapedRegex(query), "i");
  const results = await Promise.all(allowed.map((type) => SEARCHERS[type](query, search, user)));
  return { ...base, groups: allowed.map((type, index) => ({ type, items: results[index] })) };
}
