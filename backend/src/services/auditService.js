import crypto from "crypto";
import AuditLog from "../models/AuditLog.js";

export function clientIp(req) {
  return String(req?.headers?.["x-forwarded-for"] || req?.ip || req?.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

export function electronicSignature(user, createdAt = new Date()) {
  const actor = String(user?._id || "system").slice(-8).toUpperCase();
  return `UMA-${actor}-${createdAt.getTime().toString(36).toUpperCase()}`;
}

export function requestSnapshotHash(request) {
  const snapshot = {
    id: String(request?._id || ""),
    requestNumber: request?.requestNumber,
    status: request?.status,
    supplier: String(request?.supplier?._id || request?.supplier || ""),
    currency: request?.currency,
    totalAmount: request?.totalAmount,
    penEquivalent: request?.totalPENEquivalent ?? request?.penEquivalent,
    accountingPeriod: request?.accountingPeriod,
    updatedAt: request?.updatedAt
  };
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function workflowEvent({ action, from = null, to, user, req, comments, stage, startedAt, dueAt, completedAt, request }) {
  const createdAt = new Date();
  const effectiveCompletedAt = completedAt || (from ? createdAt : undefined);
  const slaResult = dueAt && effectiveCompletedAt
    ? (effectiveCompletedAt.getTime() <= new Date(dueAt).getTime() ? "ON_TIME" : "OVERDUE")
    : "NOT_APPLICABLE";
  return {
    action,
    statusFrom: from,
    statusTo: to,
    actor: user?._id,
    actorName: user?.name,
    role: user?.role,
    comments,
    ip: clientIp(req),
    signature: electronicSignature(user, createdAt),
    signatureType: "AUTHENTICATED_ELECTRONIC_SIGN_OFF",
    snapshotHash: requestSnapshotHash(request),
    stage,
    startedAt,
    dueAt,
    completedAt: effectiveCompletedAt,
    slaResult,
    createdAt
  };
}

export async function recordAudit({
  entityType,
  entity,
  action,
  user,
  req,
  comments,
  changes = {},
  module = "SYSTEM",
  message,
  oldValues,
  newValues,
  blocked = false,
  blockReason,
  period,
  requestId,
  session
}) {
  const entityId = entity?._id || entity;
  const requestEntityId = requestId || (entityType === "FinancialRequest" ? entityId : entity?.request?._id || entity?.request);
  const payload = {
    user: user?._id,
    actor: user?._id,
    actorName: user?.name,
    role: user?.role,
    ip: clientIp(req),
    module,
    entity: entityType,
    entityType,
    entityId,
    requestId: requestEntityId,
    requestNumber: entity?.requestNumber,
    action,
    message: message || comments,
    comments,
    oldValues,
    newValues,
    changes,
    blocked,
    blockReason,
    period
  };
  const [audit] = await AuditLog.create([payload], session ? { session } : undefined);
  return audit;
}
