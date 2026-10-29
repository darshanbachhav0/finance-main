import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import app from "../src/app.js";
import AuditLog from "../src/models/AuditLog.js";
import { assertAccessChange } from "../src/controllers/userController.js";
import User from "../src/models/User.js";
import { createAdministrator, resetAdministratorTwoFactor } from "../src/services/adminAccountService.js";
import { CANONICAL_ROLE_MIGRATION_KEY, planUserAccess, rollbackCanonicalRoleMigration, runCanonicalRoleMigration } from "../src/services/canonicalRoleMigrationService.js";
import { clearPlatformSettingsCache } from "../src/services/platformSettingsService.js";
import { amountTierStages } from "../src/services/approvalRuleService.js";
import { securityAlertKind } from "../src/services/securityAlertRules.js";
import { PERMISSIONS, ROLES } from "../src/utils/constants.js";

const PASSWORD = "Strong-Password-1!";

test("the User model refuses blocking role combinations and rewrites retired values", async () => {
  const blocked = new User({ name: "T", dni: "71000001", passwordHash: "x", role: ROLES.TREASURY, roles: [ROLES.GAF] });
  const error = await blocked.validate().then(() => null, (caught) => caught);
  assert.ok(error?.errors?.roles, "Tesorería + GAF cannot be saved");
  const legacy = new User({ name: "L", dni: "71000002", passwordHash: "x", role: "SuperAdmin", roles: ["Procurement", "SuperAdmin"], permissions: ["request:create", "user:manage"] });
  await legacy.validate();
  assert.equal(legacy.role, ROLES.ADMIN);
  assert.deepEqual([...legacy.roles], [ROLES.SOLICITOR]);
  assert.deepEqual([...legacy.permissions], [PERMISSIONS.REQUEST_CREATE, PERMISSIONS.EMPLOYEE_MANAGE]);
  assert.equal(securityAlertKind({ entityType: "AccountingPeriod", action: "REOPENED" }), "PERIOD_REOPENED");
});

test("migration plan: retired roles, Legal and Gestión de Personas, dropped duties, review flags", () => {
  const superAdmin = planUserAccess({ role: "SuperAdmin", permissions: [], active: true });
  assert.equal(superAdmin.role, ROLES.ADMIN);
  const viewer = planUserAccess({ role: "ManagementViewer", permissions: ["management-portal:view"], active: true });
  assert.equal(viewer.role, ROLES.AUDITOR);
  assert.deepEqual(viewer.permissions, [], "insights come with Auditoría, not as a grant");
  assert.ok(viewer.reasons.some((reason) => reason.includes("Management Viewer")));
  const legal = planUserAccess({ role: ROLES.LEGAL, active: true, jefe: "j", costCenter: "c" });
  assert.deepEqual(legal.roles, [ROLES.SOLICITOR], "keeps registering requests, flagged for confirmation");
  assert.equal(legal.reasons.length, 1);
  const budget = planUserAccess({ role: "Budget", active: true, jefe: "j" });
  assert.equal(budget.role, ROLES.TREASURY);
  assert.deepEqual(budget.reasons, []);
});

test("Administración: one administrator role, access assignment, segregation and history", { timeout: 120000 }, async (t) => {
  const database = `erp_admin_access_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  clearPlatformSettingsCache();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (route, { token, method = "GET", body } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const signIn = async (dni) => (await call("/auth/login", { method: "POST", body: { dni, password: PASSWORD } })).body;
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const make = (name, dni, role, extra = {}) => User.create({ name, dni, passwordHash, role, area: "General", passwordChangedAt: new Date(), ...extra });
    const admin = await make("Main Admin", "71000010", ROLES.ADMIN);
    const auditor = await make("Auditora", "71000011", ROLES.AUDITOR);
    const treasurer = await make("Tesorera", "71000012", ROLES.TREASURY);
    const solicitor = await make("Solicitante", "71000013", ROLES.SOLICITOR);
    const adminToken = (await signIn("71000010")).token;
    const auditorToken = (await signIn("71000011")).token;

    await t.test("the session carries every role, its code and the effective permissions", async () => {
      const me = (await call("/auth/me", { token: adminToken })).body.user;
      assert.deepEqual(me.roles, [ROLES.ADMIN]);
      assert.deepEqual(me.roleCodes, ["ADMIN"]);
      assert.ok(me.effectivePermissions.includes(PERMISSIONS.EMPLOYEE_MANAGE));
      assert.equal(me.effectivePermissions.includes(PERMISSIONS.REQUEST_APPROVE), false);
    });

    await t.test("the administrator reads no financial workspace and approves nothing", async () => {
      assert.equal((await call("/treasury/queue", { token: adminToken })).status, 403);
      assert.equal((await call("/accounting/accounts-payable", { token: adminToken })).status, 403);
      assert.equal((await call("/accounting/bank-files", { token: adminToken })).status, 403);
      assert.equal((await call("/investments", { token: adminToken })).status, 403);
      const inbox = await call("/approvals/inbox", { token: adminToken });
      assert.equal(inbox.status, 200);
      assert.equal(inbox.body.data.length, 0, "only steps assigned to them");
      const list = await call("/requests", { token: adminToken });
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 0);
    });

    await t.test("Auditoría reads financial work and the full audit trail, writes nothing", async () => {
      assert.equal((await call("/treasury/queue", { token: auditorToken })).status, 200);
      assert.equal((await call("/administration/audit", { token: auditorToken })).status, 200);
      assert.equal((await call("/users", { token: auditorToken })).status, 403);
      assert.equal((await call("/suppliers", { token: auditorToken, method: "POST", body: {} })).status, 403);
    });

    let createdId;
    await t.test("an employee gets several roles under one identity; blocked combinations are refused", async () => {
      const created = await call("/users", { token: adminToken, method: "POST", body: { name: "Jefa y solicitante", dni: "71000020", password: PASSWORD, role: ROLES.SOLICITOR, roles: [ROLES.AREA_DIRECTOR], area: "General" } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      createdId = created.body.data._id;
      assert.deepEqual(created.body.data.roles, [ROLES.AREA_DIRECTOR]);
      const refused = await call(`/users/${treasurer._id}`, { token: adminToken, method: "PUT", body: { roles: [ROLES.GAF] } });
      assert.equal(refused.status, 422);
      assert.deepEqual(refused.body.details.segregationOfDuties, ["BATCH_GENERATE_APPROVE"]);
      assert.equal((await call(`/users/${auditor._id}`, { token: adminToken, method: "PUT", body: { roles: [ROLES.SOLICITOR] } })).status, 422, "Auditoría stays independent");
      const audit = await AuditLog.findOne({ entityId: new mongoose.Types.ObjectId(createdId), action: "ROLES_CHANGED" }).lean();
      assert.deepEqual(audit.newValues.roles, [ROLES.SOLICITOR, ROLES.AREA_DIRECTOR]);
    });

    await t.test("no self-escalation and the last active administrator stays", async () => {
      const self = await call(`/users/${admin._id}`, { token: adminToken, method: "PUT", body: { roles: [ROLES.GAF] } });
      assert.equal(self.status, 403);
      assert.equal(self.body.code, "ADMIN_ACCOUNT_PROTECTED");
      // A second administrator can change the first one; the first then loses employee management.
      assert.equal((await call(`/users/${solicitor._id}`, { token: adminToken, method: "PUT", body: { role: ROLES.ADMIN } })).status, 200);
      const secondToken = (await signIn("71000013")).token;
      assert.equal((await call(`/users/${admin._id}`, { token: secondToken, method: "PUT", body: { role: ROLES.SOLICITOR } })).status, 200, "another administrator remains");
      const last = await call(`/users/${solicitor._id}`, { token: (await signIn("71000010")).token, method: "PUT", body: { role: ROLES.SOLICITOR } });
      assert.equal(last.status, 403, "the former administrator no longer manages employees");
      assert.equal((await call(`/users/${solicitor._id}`, { token: secondToken, method: "DELETE" })).status, 409, "cannot deactivate oneself");
      await User.updateOne({ _id: admin._id }, { $set: { role: ROLES.ADMIN } });
      await User.updateOne({ _id: solicitor._id }, { $set: { role: ROLES.SOLICITOR } });
      // Defensive rule for any path that reaches it (scripts, a future screen): the only active
      // administrator never loses the role or the account.
      const target = await User.findById(admin._id);
      await assert.rejects(() => assertAccessChange(target, { role: ROLES.SOLICITOR }, { _id: "system" }), (error) => error.code === "LAST_ADMIN");
      await assert.rejects(() => assertAccessChange(target, { active: false }, { _id: "system" }), (error) => error.code === "LAST_ADMIN");
    });

    await t.test("access review lists conflicts, flagged records and gaps; each person has a history", async () => {
      await User.collection.insertOne({ name: "Pre-rule", dni: "71000030", passwordHash, role: ROLES.ACCOUNTING, roles: [ROLES.TREASURY], active: true, area: "General" });
      await User.updateOne({ _id: treasurer._id }, { $set: { accessReview: { required: true, reasons: ["Revisar"] } } });
      const review = await call("/users/access-review", { token: adminToken });
      assert.equal(review.status, 200);
      assert.ok(review.body.data.conflicts.some((item) => item.rule === "PROVISION_PAY" && item.severity === "block"));
      assert.equal(review.body.data.flagged.length, 1);
      assert.ok(review.body.data.noSupervisor.length >= 1);
      assert.ok(review.body.data.administrators.length >= 1);
      const history = await call(`/users/${createdId}/history`, { token: adminToken });
      assert.equal(history.status, 200);
      assert.ok(history.body.data.some((row) => row.action === "ROLES_CHANGED"));
      const cleared = await call(`/users/${treasurer._id}`, { token: adminToken, method: "PUT", body: { accessReviewed: true } });
      assert.equal(cleared.body.data.accessReview.required, false);
    });

    await t.test("the administrator console: overview, settings and an administrative audit trail", async () => {
      assert.equal((await call("/administration/overview", { token: adminToken })).status, 200);
      assert.equal((await call("/administration/settings", { token: adminToken })).status, 200);
      const trail = await call("/administration/audit", { token: adminToken });
      assert.equal(trail.status, 200);
      assert.ok(trail.body.data.every((row) => ["USER_ADMIN", "AUTH", "SUPER_ADMIN", "PLATFORM", "MASTER_DATA", "SECURITY"].includes(row.module)));
      assert.equal((await call("/administration/overview", { token: auditorToken })).status, 403);
    });

    await t.test("break-glass administrator accounts from the server", async () => {
      const created = await createAdministrator({ dni: "71000040", name: "Emergencia" });
      assert.equal(created.user.role, ROLES.ADMIN);
      await assert.rejects(() => createAdministrator({ dni: "71000013", name: "Duplicate" }), /already exists/);
      await User.updateOne({ _id: created.user._id }, { $set: { twoFactor: { enabled: true, secret: "x" } } });
      const reset = await resetAdministratorTwoFactor({ dni: "71000040" });
      assert.equal(reset.twoFactor.enabled, false);
    });

    await t.test("anti-fragmentation and payments to Tesorería staff raise the route", async () => {
      const thresholds = { uit: 5000, superiorUit: 0, gafUit: 5, generalManagementUit: 20 };
      const supplier = new mongoose.Types.ObjectId();
      const center = new mongoose.Types.ObjectId();
      const base = { flowType: "B", supplier, requesterCostCenter: center, status: "PENDIENTE_APROBACION", createdAt: new Date() };
      await mongoose.connection.db.collection("financialrequests").insertMany([
        { ...base, requestNumber: "FRAG-1", totalPENEquivalent: 15000 },
        { ...base, requestNumber: "FRAG-2", totalPENEquivalent: 9000 },
        { ...base, requestNumber: "FRAG-OLD", totalPENEquivalent: 90000, createdAt: new Date(Date.now() - 40 * 86400000) },
        { ...base, requestNumber: "FRAG-REJ", totalPENEquivalent: 90000, status: "RECHAZADO" }
      ]);
      const small = { _id: new mongoose.Types.ObjectId(), ...base, totalPENEquivalent: 2000 };
      assert.deepEqual(await amountTierStages({ ...small, supplier: new mongoose.Types.ObjectId() }, thresholds), [], "alone it stays below 5 UIT");
      assert.deepEqual(await amountTierStages(small, thresholds), ["GAF"], "15000 + 9000 + 2000 within 30 days is above 5 UIT");
      const treasurer = await User.findOne({ dni: "71000012" });
      assert.deepEqual(await amountTierStages({ flowType: "C", requester: treasurer._id, totalPENEquivalent: 100 }, thresholds), ["GAF"]);
      assert.deepEqual(await amountTierStages({ flowType: "C", requester: (await User.findOne({ dni: "71000020" }))._id, totalPENEquivalent: 100 }, thresholds), []);
    });

    await t.test("migration: dry run writes nothing, apply rewrites access only, rollback restores it", async () => {
      const db = mongoose.connection.db;
      const { insertedIds } = await db.collection("users").insertMany([
        { name: "Old super", dni: "71000050", role: "SuperAdmin", permissions: [], active: true },
        { name: "Old buyer", dni: "71000051", role: "Procurement", permissions: ["procurement-order:create", "supplier:homologate"], active: true },
        { name: "Old viewer", dni: "71000052", role: "ManagementViewer", permissions: ["management-portal:view"], active: true }
      ]);
      await db.collection("approvalrules").insertMany([{ name: "Old admin stage", role: "Admin", active: true }, { name: "Old budget stage", role: "Budget", active: true }]);
      await db.collection("financialrequests").insertOne({ requestNumber: "HIST-1", approvalHistory: [{ action: "APPROVED", role: "SuperAdmin" }] });

      const dryRun = await runCanonicalRoleMigration({ apply: false, db });
      assert.equal(dryRun.summary.retiredRoles.SuperAdmin, 1);
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[0] })).role, "SuperAdmin", "dry run writes nothing");

      const applied = await runCanonicalRoleMigration({ apply: true, db });
      const buyer = await db.collection("users").findOne({ _id: insertedIds[1] });
      assert.equal(buyer.role, ROLES.SOLICITOR);
      assert.deepEqual(buyer.permissions, [PERMISSIONS.PURCHASE_ORDER_ISSUE]);
      assert.equal(buyer.accessReview.required, true);
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[2] })).role, ROLES.AUDITOR);
      assert.equal((await db.collection("approvalrules").findOne({ name: "Old admin stage" })).active, false, "deactivated, not deleted");
      assert.equal((await db.collection("approvalrules").findOne({ name: "Old budget stage" })).role, ROLES.TREASURY);
      assert.equal((await db.collection("financialrequests").findOne({ requestNumber: "HIST-1" })).approvalHistory[0].role, "SuperAdmin", "history keeps the role it was decided under");
      assert.ok(await db.collection("migrationruns").findOne({ key: CANONICAL_ROLE_MIGRATION_KEY }));
      assert.equal((await runCanonicalRoleMigration({ apply: false, db })).userChanges.filter((change) => ["71000050", "71000051", "71000052"].includes(change.dni)).length, 0, "running it again changes nothing");

      const rolledBack = await rollbackCanonicalRoleMigration({ ...applied, summary: applied.summary }, { db });
      assert.ok(rolledBack.restored >= 3);
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[1] })).role, "Procurement");
      assert.equal((await db.collection("approvalrules").findOne({ name: "Old admin stage" })).active, true);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
