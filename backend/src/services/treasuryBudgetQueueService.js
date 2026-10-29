import AccountsPayable from "../models/AccountsPayable.js";
import AuditLog from "../models/AuditLog.js";
import FinancialRequest from "../models/FinancialRequest.js";
import Supplier from "../models/Supplier.js";
import { paginatedPayload, parsePagination, parseSort, escapedRegex, withDeepLink } from "./queryService.js";
import { REQUEST_STATUS } from "../utils/constants.js";

// A final approval can survive a failed automatic handoff. These are Treasury's
// budget tasks, not payables: never offer them for scheduling or bank-file generation.
function pendingBudgetPipeline(filters = {}) {
  return [
    { $match: { ...filters, status: { $in: [REQUEST_STATUS.APPROVED, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] },
      flowType: { $ne: "D" }, approvalRouteSnapshot: { $not: { $elemMatch: { required: { $ne: false }, status: { $in: ["PENDING", "NOT_REACHED"] } } } } } },
    { $lookup: { from: AccountsPayable.collection.name, let: { requestId: "$_id" }, pipeline: [
      { $match: { $expr: { $eq: ["$request", "$$requestId"] }, status: { $ne: "CANCELLED" } } }, { $limit: 1 }, { $project: { _id: 1 } }
    ], as: "_existingPayable" } },
    { $match: { _existingPayable: { $size: 0 } } },
    { $project: { requestNumber: 1, title: 1, supplier: 1, requester: 1, solicitor: 1, requesterArea: 1, flowType: 1,
      currency: 1, totalAmount: 1, status: 1, createdAt: 1, updatedAt: 1 } }
  ];
}

export async function countPendingTreasuryBudgets() {
  const [result] = await FinancialRequest.aggregate([...pendingBudgetPipeline(), { $count: "total" }]);
  return result?.total || 0;
}

export async function listPendingTreasuryBudgets(params = {}) {
  const filters = {};
  if (params.search) {
    const search = new RegExp(escapedRegex(params.search), "i");
    const supplierIds = await Supplier.distinct("_id", { $or: [{ name: search }, { legalName: search }, { rucDni: search }] });
    filters.$or = [{ requestNumber: search }, { title: search }, { supplier: { $in: supplierIds } }];
  }
  withDeepLink(filters, params, { request: "_id" });
  const { page, pageSize, skip } = parsePagination(params);
  const sort = parseSort(params, ["requestNumber", "createdAt", "updatedAt", "totalAmount"], { updatedAt: 1 });
  const [result] = await FinancialRequest.aggregate([...pendingBudgetPipeline(filters), { $facet: {
    data: [{ $sort: sort }, { $skip: skip }, { $limit: pageSize }], total: [{ $count: "count" }]
  } }]);
  const rows = await FinancialRequest.populate(result?.data || [], [
    { path: "supplier", select: "name legalName rucDni homologationStatus" },
    { path: "requester", select: "name" }
  ]);
  const events = await AuditLog.find({ entityType: "FinancialRequest", entityId: { $in: rows.map(row => row._id) },
    action: { $in: ["BUDGET_COMMITMENT_PENDING", "BUDGET_COMMITMENT_DEFERRED"] } }).select("entityId message createdAt").sort({ createdAt: -1 }).lean();
  const reasons = new Map();
  for (const event of events) if (!reasons.has(String(event.entityId))) reasons.set(String(event.entityId), event.message);
  return paginatedPayload(rows.map(row => ({ ...row, pendingReason: reasons.get(String(row._id)) || "Budget commitment is pending." })), result?.total?.[0]?.count || 0, page, pageSize);
}
