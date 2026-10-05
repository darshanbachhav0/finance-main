import mongoose from "mongoose";
import BudgetPlanChange from "../models/BudgetPlanChange.js";
import { recordAudit } from "./auditService.js";
import { applyPlanChange } from "./budgetPlanService.js";
import { notificationText, notifyUser, resolveNotification } from "./notificationService.js";
import { paginatedPayload, parsePagination } from "./queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";

// Budget plan changes above the approval threshold: Admin requests, Management decides, the
// requesting Admin may withdraw while it is still pending.
const populated = (query) => query
  .populate({ path: "plan", select: "period planningMode costCenter project", populate: { path: "costCenter", select: "code name" } })
  .populate("requestedBy decidedBy", "name role");

export async function listBudgetPlanChanges(query = {}) {
  const filter = {};
  if (query.record) {
    if (!mongoose.isValidObjectId(query.record)) throw new AppError(422, "Select a valid budget change.", undefined, ERROR_CODES.VALIDATION_ERROR);
    filter._id = query.record;
  }
  if (query.status) filter.status = String(query.status).toUpperCase();
  const { page, pageSize, skip } = parsePagination(query);
  const [data, total] = await Promise.all([
    populated(BudgetPlanChange.find(filter).sort({ status: -1, createdAt: -1 }).skip(skip).limit(pageSize)),
    BudgetPlanChange.countDocuments(filter)
  ]);
  return paginatedPayload(data, total, page, pageSize);
}

async function loadPending(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(422, "Select a valid budget change.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const change = await BudgetPlanChange.findById(id);
  if (!change) throw new AppError(404, "Budget change not found.", undefined, ERROR_CODES.NOT_FOUND);
  if (change.status !== "PENDING") throw new AppError(409, "This budget change was already decided.", { status: change.status }, ERROR_CODES.CONFLICT);
  return change;
}

export async function decideBudgetPlanChange(id, { decision, comments } = {}, user, req) {
  if (user?.role !== ROLES.MANAGEMENT) throw new AppError(403, "Only Management decides budget changes above the approval threshold.", undefined, ERROR_CODES.FORBIDDEN);
  const action = String(decision || "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(action)) throw new AppError(422, "Approve or reject the budget change.", undefined, ERROR_CODES.VALIDATION_ERROR);
  const text = String(comments || "").trim();
  if (!text) throw new AppError(422, "Decision comments are required.", { field: "comments" }, ERROR_CODES.VALIDATION_ERROR);
  const change = await loadPending(id);
  if (action === "APPROVE") {
    // Every rule is checked again on the plan as it is now; if it no longer fits, the change stays
    // pending and Management sees why (and can reject it).
    await applyPlanChange(change.plan, change.payload, {
      actor: { _id: change.requestedBy, name: change.requestedByName },
      operationId: change.operationId,
      reasonText: change.reason,
      approval: { change, user },
      req
    });
  }
  const decided = await BudgetPlanChange.findOneAndUpdate(
    { _id: change._id, status: "PENDING" },
    { $set: { status: action === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: user._id, decidedByName: user.name, decidedAt: new Date(), decisionComments: text, ...(action === "APPROVE" ? { appliedAt: new Date() } : {}) } },
    { new: true }
  );
  if (!decided) throw new AppError(409, "This budget change was already decided.", undefined, ERROR_CODES.CONFLICT);
  await recordAudit({ entityType: "BudgetPlanChange", entity: decided, action: action === "APPROVE" ? "BUDGET_CHANGE_APPROVED" : "BUDGET_CHANGE_REJECTED", module: "BUDGET", user, req, comments: text, oldValues: { status: "PENDING" }, newValues: { status: decided.status, summary: decided.summary } });
  await resolveNotification(`budget-plan-change:${decided._id}`);
  await notifyUser({
    userId: decided.requestedBy,
    eventKey: `budget-plan-change:${decided._id}:decision`,
    type: "BUDGET_PLAN_CHANGE",
    title: action === "APPROVE" ? notificationText("Budget change approved") : notificationText("Budget change rejected"),
    message: notificationText("{summary}. Comments: {comments}", { summary: decided.summary, comments: text }),
    path: `/budget?tab=changes&record=${decided._id}`,
    entityType: "BudgetPlanChange",
    entityId: decided._id
  });
  return populated(BudgetPlanChange.findById(decided._id));
}

export async function cancelBudgetPlanChange(id, user, req) {
  if (user?.role !== ROLES.ADMIN) throw new AppError(403, "Only Admin can withdraw a budget change.", undefined, ERROR_CODES.FORBIDDEN);
  const change = await loadPending(id);
  const cancelled = await BudgetPlanChange.findOneAndUpdate({ _id: change._id, status: "PENDING" }, { $set: { status: "CANCELLED", decidedBy: user._id, decidedByName: user.name, decidedAt: new Date() } }, { new: true });
  if (!cancelled) throw new AppError(409, "This budget change was already decided.", undefined, ERROR_CODES.CONFLICT);
  await recordAudit({ entityType: "BudgetPlanChange", entity: cancelled, action: "BUDGET_CHANGE_CANCELLED", module: "BUDGET", user, req, oldValues: { status: "PENDING" }, newValues: { status: "CANCELLED" } });
  await resolveNotification(`budget-plan-change:${cancelled._id}`);
  return populated(BudgetPlanChange.findById(cancelled._id));
}

export async function countPendingBudgetPlanChanges() {
  return BudgetPlanChange.countDocuments({ status: "PENDING" });
}
