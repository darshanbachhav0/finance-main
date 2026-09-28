import mongoose from "mongoose";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";

const open = step => ["PENDING", "NOT_REACHED"].includes(step.status);
export function planHierarchyFinalization(request) {
  if (request.status !== "PENDIENTE_APROBACION" || request.approvalRoutingMode !== "MANAGER_CHAIN") return null;
  const route = [...(request.approvalRouteSnapshot || [])].sort((a, b) => a.sequence - b.sequence);
  if (!route.some(step => step.source === "RULE_BASED" && open(step))) return null;
  if (route.some(step => step.source === "MANAGER_CHAIN" && open(step))) return { review: "A manager still has a pending decision; use the normal approval action." };
  const last = route.filter(step => step.source === "MANAGER_CHAIN" && step.status === "APPROVED").at(-1);
  if (!last?.completedBy || !last.completedAt) return { review: "No completed manager decision." };
  // Old finalize used <level>_APPROVED; forwarding used CHAIN_APPROVED_FORWARDED.
  // Require the exact actor, stage and timestamp; never infer from comments.
  const evidence = (request.approvalHistory || []).find(event =>
    event.action === `${last.approvalLevel}_APPROVED` &&
    String(event.actor) === String(last.completedBy) &&
    event.stage === last.approvalLevel &&
    Math.abs(new Date(event.createdAt) - new Date(last.completedAt)) < 5000);
  if (!evidence) return { review: "Finalization choice cannot be proved from recorded history." };
  if (route.some(step => step.sequence > last.sequence && !open(step) && step.status !== "SKIPPED")) return { review: "A later decision exists; review manually." };
  return { route: route.map(step => open(step) ? { ...step, status: "SKIPPED", completedAt: new Date() } : step), evidence };
}

export async function migrateHierarchyFinalization(db, { apply = false } = {}) {
  const report = { mode: apply ? "APPLY" : "DRY_RUN", ready: [], manualReview: [] };
  for await (const request of db.collection("financialrequests").find({ status: "PENDIENTE_APROBACION", approvalRoutingMode: "MANAGER_CHAIN" })) {
    const plan = planHierarchyFinalization(request);
    if (!plan) continue;
    if (plan.review) { report.manualReview.push({ request: request.requestNumber, reason: plan.review }); continue; }
    report.ready.push(request.requestNumber);
    if (!apply) continue;
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        const eventKey = `hierarchy-finalization-v1:${request._id}`;
        const event = { action: "HIERARCHY_FINALIZATION_MIGRATED", actorName: "System migration", role: "SYSTEM", statusFrom: request.status, statusTo: "APROBADO", createdAt: now, comments: "Honored the recorded jefe finalization. Financial controls remain pending." };
        const result = await db.collection("financialrequests").updateOne({ _id: request._id, status: request.status, updatedAt: request.updatedAt, approvalRouteSnapshot: request.approvalRouteSnapshot }, {
          $set: { status: "APROBADO", approvalStage: "COMPLETE", approvalDueAt: null, approvalRouteSnapshot: plan.route, updatedAt: now },
          $inc: { __v: 1 }, $push: { approvalHistory: event }
        }, { session });
        if (result.modifiedCount !== 1) throw new Error(`Concurrent change: ${request.requestNumber}; rerun dry-run.`);
        await db.collection("auditlogs").insertOne({ ...event, eventKey, entity: "FinancialRequest", entityType: "FinancialRequest", entityId: request._id, requestId: request._id, requestNumber: request.requestNumber, module: "APPROVALS", oldValues: { status: request.status, approvalRouteSnapshot: request.approvalRouteSnapshot }, newValues: { status: "APROBADO", approvalRouteSnapshot: plan.route, evidence: plan.evidence } }, { session });
        await db.collection("notifications").updateMany({ entityId: request._id, type: { $in: ["APPROVAL_PENDING", "SLA_DUE_SOON", "SLA_OVERDUE", "SLA_ESCALATION"] }, resolvedAt: null }, { $set: { resolvedAt: now } }, { session });
        const recipients = await db.collection("users").find({ active: true, role: { $in: ["Budget", "Admin"] } }, { session, projection: { _id: 1 } }).toArray();
        for (const recipient of recipients) await db.collection("notifications").updateOne({ user: recipient._id, eventKey }, { $setOnInsert: { user: recipient._id, eventKey, type: "BUDGET_COMMITMENT", title: "Budget commitment required", message: `${request.requestNumber}: jefe approval is complete. Review budget controls.`, path: "/budget", entityType: "FinancialRequest", entityId: request._id, createdAt: now, updatedAt: now } }, { upsert: true, session });
      });
    } finally { await session.endSession(); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
    console.log(JSON.stringify(await migrateHierarchyFinalization(mongoose.connection.db, { apply: process.argv.includes("--apply") }), null, 2));
  } finally { await mongoose.disconnect(); }
}
