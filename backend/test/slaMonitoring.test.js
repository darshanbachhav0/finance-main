import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import FinancialRequest from "../src/models/FinancialRequest.js";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import { checkApprovalSlas, approvalSlaCycle } from "../src/services/slaMonitoringService.js";
import { classifyApprovalSla } from "../src/services/slaPolicy.js";
import { recordAudit } from "../src/services/auditService.js";
import { transitionRequest } from "../src/services/workflowService.js";

test("SLA notifications, escalation, retries and immutable audit", { timeout: 120000 }, async t => {
  const database = `erp_sla_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  const now = new Date("2026-09-18T12:00:00Z");
  const config = { dueSoonHours: 4, escalationHours: 24, pollMs: 60000 };
  const oid = () => new mongoose.Types.ObjectId();
  try {
    await Promise.all([Notification.init(), AuditLog.init()]);
    const director = { _id: oid(), name: "Director", role: "Approver", approvalLevel: "AREA_DIRECTOR", area: "Operations", active: true };
    const vice = { ...director, _id: oid(), name: "Vice Rector", approvalLevel: "VICE_RECTOR" };
    const other = { ...director, _id: oid(), area: "Other" };
    const manager = { _id: oid(), name: "Management", role: "Management", active: true };
    await User.collection.insertMany([director, vice, other, manager].map((user, i) => ({ ...user, email: `sla${i}@test.local`, passwordHash: "unused" })));
    const id = oid(), stepId = oid();
    const dueAt = new Date(now.getTime() + 3600000);
    await FinancialRequest.collection.insertOne({ _id: id, requestNumber: "SLA-TEST", requester: oid(), status: "PENDIENTE_APROBACION", requesterArea: "Operations", approvalStage: "AREA_DIRECTOR", approvalDueAt: dueAt,
      approvalRouteSnapshot: [{ _id: stepId, sequence: 1, role: "Approver", approvalLevel: "AREA_DIRECTOR", required: true, status: "PENDING", startedAt: new Date(now.getTime() - 23 * 3600000), dueAt }] });
    const scan = at => checkApprovalSlas({ now: at || now, config });

    await t.test("due soon reaches only eligible current approvers", async () => {
      await scan();
      const alerts = await Notification.find({ type: "SLA_DUE_SOON" });
      assert.equal(alerts.length, 1);
      assert.equal(String(alerts[0].user), String(director._id));
      assert.equal(classifyApprovalSla(dueAt, now, { ...config, dueSoonHours: 0.5 }).alert, null);
    });
    await t.test("overdue supersedes due-soon and does not reset read state", async () => {
      const at = new Date(dueAt.getTime() + 1000);
      await scan(at);
      assert.equal(await Notification.countDocuments({ type: "SLA_DUE_SOON", resolvedAt: null }), 0);
      const alert = await Notification.findOne({ type: "SLA_OVERDUE" });
      alert.readAt = now; await alert.save();
      await Promise.all([scan(at), scan(at)]);
      assert.equal(await Notification.countDocuments({ type: "SLA_OVERDUE" }), 1);
      assert.ok((await Notification.findById(alert._id)).readAt);
    });
    await t.test("long overdue escalates once to approver and Management with one immutable audit", async () => {
      const at = new Date(dueAt.getTime() + 25 * 3600000);
      await Promise.all([scan(at), scan(at)]);
      assert.equal(await Notification.countDocuments({ type: "SLA_ESCALATION" }), 2);
      assert.equal(await AuditLog.countDocuments({ action: "SLA_ESCALATION" }), 1);
      const audit = await AuditLog.findOne({ action: "SLA_ESCALATION" });
      assert.equal(audit.statusFrom, "PENDIENTE_APROBACION");
      assert.equal(audit.statusTo, audit.statusFrom);
      assert.equal(audit.actorName, "SLA worker");
      assert.ok(audit.comments && audit.createdAt);
    });
    await t.test("resolved approval stops alerts and resolves bell entries without changing due history", async () => {
      await FinancialRequest.collection.updateOne({ _id: id }, { $set: { status: "APROBADO_VICERRECTOR", approvalStage: "COMPLETE", "approvalRouteSnapshot.0.status": "APPROVED" } });
      await scan(new Date(dueAt.getTime() + 48 * 3600000));
      assert.equal(await Notification.countDocuments({ resolvedAt: null }), 0);
      assert.equal(await Notification.countDocuments({ type: "SLA_ESCALATION" }), 2);
      assert.equal(await AuditLog.countDocuments({ action: "SLA_ESCALATION" }), 1);
      assert.equal((await FinancialRequest.findById(id)).approvalRouteSnapshot[0].dueAt.toISOString(), dueAt.toISOString());
    });
    await t.test("new approval stage gets a new alert cycle; terminal and observed states never alert", async () => {
      for (const status of ["RECHAZADO", "ANULADO", "CERRADO", "OBSERVADO", "DEVUELTO"]) assert.equal(approvalSlaCycle({ status, approvalDueAt: dueAt }), null);
      const nextDue = new Date(now.getTime() + 2 * 3600000);
      await FinancialRequest.collection.updateOne({ _id: id }, { $set: { status: "APROBADO_DIRECTOR", approvalStage: "VICE_RECTOR", approvalDueAt: nextDue, approvalRouteSnapshot: [{ _id: oid(), sequence: 2, role: "Approver", approvalLevel: "VICE_RECTOR", status: "PENDING", dueAt: nextDue, startedAt: now }] } });
      await scan();
      const alert = await Notification.findOne({ type: "SLA_DUE_SOON", resolvedAt: null });
      assert.equal(String(alert.user), String(vice._id));
    });
    await t.test("audit records reject save, update, replacement, bulk mutation and delete", async () => {
      const audit = await recordAudit({ entityType: "FinancialRequest", entity: { _id: id, status: "APROBADO_DIRECTOR" }, user: director, action: "STATUS_TRANSITION", oldValues: { status: "PENDIENTE_APROBACION" }, newValues: { status: "APROBADO_DIRECTOR" }, comments: "Approved" });
      assert.equal(audit.statusFrom, "PENDIENTE_APROBACION"); assert.equal(audit.statusTo, "APROBADO_DIRECTOR");
      audit.comments = "Tampered";
      await assert.rejects(() => audit.save(), /append-only/);
      await assert.rejects(() => AuditLog.updateOne({ _id: audit._id }, { comments: "Tampered" }), /append-only/);
      await assert.rejects(() => AuditLog.replaceOne({ _id: audit._id }, {}), /append-only/);
      await assert.rejects(() => AuditLog.findOneAndReplace({ _id: audit._id }, {}), /append-only/);
      await assert.rejects(() => AuditLog.bulkWrite([{ deleteOne: { filter: { _id: audit._id } } }]), /append-only/);
      await assert.rejects(() => audit.deleteOne(), /append-only/);
      assert.equal((await AuditLog.findById(audit._id)).comments, "Approved");
    });
    await t.test("Admin override cannot bypass separation of duties or invent a workflow transition", async () => {
      await assert.rejects(() => transitionRequest({ request: { status: "PENDIENTE_APROBACION", requester: director._id }, targetStatus: "APROBADO_DIRECTOR", user: { ...director, role: "Admin" }, adminOverrideReason: "Emergency" }), /overrides are disabled/);
    });
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
