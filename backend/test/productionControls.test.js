import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateOrgRoster } from "../scripts/migrateOrgRosterAndManagerChain.js";
import { migrateDocumentPhases } from "../scripts/migrateDocumentPhases.js";
import User from "../src/models/User.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import ApprovalRule from "../src/models/ApprovalRule.js";
import Notification from "../src/models/Notification.js";
import AuditLog from "../src/models/AuditLog.js";
import BankFormatConfiguration from "../src/models/BankFormatConfiguration.js";
import { initializeApprovalRoute, activeApprovalStep, activateNextChainStep, finalizeChainApproval, advanceApprovalRoute } from "../src/services/approvalRuleService.js";
import { notifyApprovalStep } from "../src/services/notificationService.js";
import { checkApprovalSlas } from "../src/services/slaMonitoringService.js";
import { validateSupervisor } from "../src/controllers/userController.js";
import { login, changePassword } from "../src/controllers/authController.js";
import { protect } from "../src/middleware/auth.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { installBbvaTestConfiguration } from "./bbvaFixtures.js";
import { BbvaBankFileAdapter } from "../src/integrations/banks/BbvaBankFileAdapter.js";
import { certifyBankFormatConfiguration } from "../src/services/treasuryService.js";

async function call(handler, request) {
  const response = { body: null, statusCode: 200, json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; } };
  let error;
  await handler(request, response, value => { error = value; });
  return { response, error };
}

test("production control regressions", { timeout: 60000 }, async t => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_production_controls_${process.pid}_${Date.now()}`);
  const previousMode = process.env.NODE_ENV;
  try {
    await Promise.all([User.init(), Notification.init(), AuditLog.init()]);
    const manager = await User.create({ name: "Manager", role: "Solicitor", passwordHash: "unused" });
    const owner = await User.create({ name: "Employee", dni: "88889999", jefe: manager._id, passwordHash: await bcrypt.hash("InitialPassword!1", 10), passwordResetRequired: true });
    const root = await User.create({ name: "Senior manager", role: "Solicitor", passwordHash: "unused" });
    manager.jefe = root._id; await manager.save();
    let stored;
    // Flexible chain (product decision): only the first jefe is on the route at
    // submission; forwarding adds the next level, and any level may finalize.
    await t.test("a forwarded chain persists in the real request schema and any level may finalize", async () => {
      stored = new FinancialRequest({ supplier: new mongoose.Types.ObjectId(), requestType: "OPEX", flowType: "A1", description: "Saved hierarchy regression", issueDate: "2026-09-01", accountingPeriod: "2026-09", currency: "PEN", requester: owner._id, solicitor: owner._id, status: "PENDIENTE_APROBACION", lines: [{ costCenter: new mongoose.Types.ObjectId(), expenseType: new mongoose.Types.ObjectId(), netAmount: 100, igvAmount: 18, totalAmount: 118 }] });
      await initializeApprovalRoute(stored); await stored.save();
      const reloaded = await FinancialRequest.findById(stored._id);
      assert.equal(reloaded.approvalRouteSnapshot.length, 1);
      assert.equal(reloaded.approvalRouteSnapshot[0].approverSnapshot.dni, undefined);
      const forwarded = await activateNextChainStep(reloaded, activeApprovalStep(reloaded), manager);
      assert.equal(String(forwarded.next.approverUser), String(root._id));
      await reloaded.validate();
      assert.deepEqual(reloaded.approvalRouteSnapshot.map(step => step.status), ["APPROVED", "PENDING"]);
      assert.equal((await finalizeChainApproval(reloaded, activeApprovalStep(reloaded), root)).complete, true);
    });
    await t.test("manager identity receives the bell alert and SLA regardless of Solicitor role", async () => {
      await notifyApprovalStep(stored); await notifyApprovalStep(stored);
      assert.equal(await Notification.countDocuments({ user: manager._id, type: "APPROVAL_PENDING" }), 1);
      assert.equal(await Notification.countDocuments({ user: owner._id }), 0);
      const now = new Date(stored.approvalDueAt.getTime() + 1000);
      await checkApprovalSlas({ now }); await checkApprovalSlas({ now });
      assert.equal(await Notification.countDocuments({ user: manager._id, type: "SLA_OVERDUE" }), 1);
    });
    await t.test("forwarding follows the approver's current jefe; cycles/inactive managers are rejected", async () => {
      await assert.rejects(validateSupervisor(root._id, owner._id), /cycle/);
      manager.jefe = null; await manager.save();
      const route = await FinancialRequest.findById(stored._id);
      await initializeApprovalRoute(route);
      // With no jefe above the approver, "send to my jefe" is not possible: finalize instead.
      await assert.rejects(activateNextChainStep(route, activeApprovalStep(route), manager), error => error.statusCode === 422);
      root.active = false; await root.save();
      await assert.rejects(validateSupervisor(owner._id, root._id), /active/);
      root.active = true; await root.save();
    });
    await t.test("a resubmission re-resolves the route from the first approver instead of reusing the old one", async () => {
      const request = { requester: owner._id, approvalRoutingMode: "MANAGER_CHAIN", approvalRouteSnapshot: [
        { sequence: 1, required: false, source: "MANAGER_CHAIN", status: "SKIPPED", slaHours: 4 },
        { sequence: 2, required: true, source: "MANAGER_CHAIN", approverUser: root._id, status: "RETURNED", approvalLevel: "Manager", slaHours: 4 }
      ] };
      await initializeApprovalRoute(request);
      assert.equal(request.approvalRouteSnapshot.length, 1);
      assert.equal(activeApprovalStep(request).sequence, 1);
      assert.equal(String(activeApprovalStep(request).approverUser), String(manager._id));
      assert.ok(request.approvalDueAt instanceof Date);
    });
    await t.test("configured management authority is added after hierarchy and cannot be skipped", async () => {
      await ApprovalRule.create({ name: "High-value Rectorate", role: "Management", approvalLevel: "RECTORATE", flowType: "A1", sequence: 1, slaHours: 8, amountFrom: 100 });
      const request = { requester: owner._id, flowType: "A1", requestType: "OPEX", totalAmount: 118 };
      await initializeApprovalRoute(request);
      assert.equal(request.approvalRouteSnapshot.at(-1).approvalLevel, "RECTORATE");
      // Finalizing the chain at the first level still leaves the configured stage.
      const next = await finalizeChainApproval(request, activeApprovalStep(request), manager);
      assert.equal(next.complete, false);
      assert.equal(next.next.source, "RULE_BASED");
      assert.equal(advanceApprovalRoute(request, root._id).complete, true);
    });
    await t.test("initial password is enforced, change is audited, and previous tokens are revoked", async () => {
      const signed = await call(login, { body: { dni: owner.dni, password: "InitialPassword!1" } });
      assert.equal(signed.error, undefined);
      const originalToken = signed.response.body.token;
      const protectedRequest = { headers: { authorization: `Bearer ${originalToken}` }, originalUrl: "/api/requests" };
      assert.equal((await call(protect, protectedRequest)).error.code, "PASSWORD_CHANGE_REQUIRED");
      const changed = await call(changePassword, { user: owner, body: { currentPassword: "InitialPassword!1", newPassword: "PrivateNewPassword!2" } });
      assert.equal(changed.error, undefined);
      assert.equal(changed.response.body.user.passwordResetRequired, false);
      assert.equal((await call(protect, protectedRequest)).error.statusCode, 401);
      protectedRequest.headers.authorization = `Bearer ${changed.response.body.token}`;
      assert.equal((await call(protect, protectedRequest)).error, undefined);
      const audit = await AuditLog.findOne({ action: "PASSWORD_CHANGED", entityId: owner._id });
      assert.ok(audit);
      assert.ok(!JSON.stringify(audit).includes("PrivateNewPassword"));
    });
    await t.test("BBVA production requires current certification; layout edits invalidate it", async () => {
      await installBbvaTestConfiguration();
      const config = await BankFormatConfiguration.findOne({ bank: "BBVA", currency: "PEN" });
      const admin = { _id: new mongoose.Types.ObjectId(), role: "Admin" };
      process.env.NODE_ENV = "production";
      assert.throws(() => new BbvaBankFileAdapter(config.toObject()), /certification/);
      await certifyBankFormatConfiguration({ id: config._id, certified: true, certificationReference: "Test acceptance only", user: admin });
      const certified = await BankFormatConfiguration.findById(config._id);
      assert.doesNotThrow(() => new BbvaBankFileAdapter(certified.toObject()));
      certified.specificationVersion += "-CHANGED"; await certified.save();
      assert.equal(certified.certified, false);
      assert.throws(() => new BbvaBankFileAdapter(certified.toObject()), /certification/);
      await assert.rejects(certifyBankFormatConfiguration({ id: config._id, certified: "false", user: admin }), /boolean/);
      process.env.NODE_ENV = previousMode;
    });
    await t.test("document-policy migration is read-only in dry run and preserves later configuration on repeat", async () => {
      const db = mongoose.connection.db;
      const before = await db.collection("documentrules").countDocuments();
      await migrateDocumentPhases(db);
      assert.equal(await db.collection("documentrules").countDocuments(), before);
      await migrateDocumentPhases(db, { apply: true });
      await db.collection("documentrules").updateOne({ code: "DOC-A1-GOODS-SUBMISSION" }, { $set: { "requirements.0.minCount": 4 } });
      await migrateDocumentPhases(db, { apply: true });
      assert.equal((await db.collection("documentrules").findOne({ code: "DOC-A1-GOODS-SUBMISSION" })).requirements[0].minCount, 4);
      assert.equal(await db.collection("documentrules").countDocuments({ code: "DOC-A1-GOODS-SUBMISSION" }), 1);
    });
    await t.test("roster dry run never guesses nicknames; explicit supervisor DNI applies idempotently", async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "uma-roster-test-"));
      const rosterPath = path.join(directory, "roster.json");
      try {
        const jefe = await User.create({ name: "PAQUILLO TINCO JIMMY MANUEL", dni: "12344321", passwordHash: "unused" });
        const rows = [{ dni: jefe.dni, fullName: jefe.name }, { dni: owner.dni, fullName: owner.name, jefeFullName: "PAQUILLO" }];
        await fs.writeFile(rosterPath, JSON.stringify(rows));
        const report = await migrateOrgRoster(mongoose.connection.db, { rosterPath });
        assert.ok(report.manualReview.some(item => item.reason.includes("Confirm supervisor")));
        await assert.rejects(migrateOrgRoster(mongoose.connection.db, { rosterPath, apply: true }), /Unresolved supervisors/);
        rows[1].jefeDni = jefe.dni;
        await fs.writeFile(rosterPath, JSON.stringify(rows));
        await migrateOrgRoster(mongoose.connection.db, { rosterPath, apply: true });
        await migrateOrgRoster(mongoose.connection.db, { rosterPath, apply: true });
        assert.equal(String((await User.findById(owner._id)).jefe), String(jefe._id));
        assert.equal(await User.countDocuments({ dni: owner.dni }), 1);
      } finally {
        await fs.unlink(rosterPath).catch(() => undefined);
        await fs.rmdir(directory);
      }
    });
    await t.test("invalid identifiers and concurrent edits return useful client errors", async () => {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      errorHandler({ name: "CastError", path: "_id" }, {}, res);
      assert.equal(res.code, 422);
      errorHandler({ name: "VersionError" }, {}, res);
      assert.equal(res.code, 409);
    });
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});

