import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import app from "../src/app.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import BackupRun from "../src/models/BackupRun.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { authorize, authorizePermission, superAdminMayCall } from "../src/middleware/auth.js";
import { clearPlatformSettingsCache } from "../src/services/platformSettingsService.js";
import { createSuperAdmin, resetSuperAdminTwoFactor } from "../src/services/superAdminAccountService.js";
import { securityAlertKind } from "../src/services/securityAlertRules.js";
import { totpCode, totpStep } from "../src/services/twoFactorService.js";
import { APPROVAL_STAGES, MAX_SUPER_ADMINS, PERMISSIONS, REQUEST_STATUS, ROLES } from "../src/utils/constants.js";
import { canApproveStage, canModifyRequest, hasPermission } from "../src/utils/permissions.js";

const PASSWORD = "Strong-Password-1!";

test("the Super Admin role is read-only by permission", () => {
  for (const permission of [PERMISSIONS.REQUEST_VIEW_ALL, PERMISSIONS.REPORT_VIEW, PERMISSIONS.BUDGET_VIEW, PERMISSIONS.AUDIT_VIEW]) assert.equal(hasPermission(ROLES.SUPER_ADMIN, permission), true, permission);
  for (const permission of [PERMISSIONS.REQUEST_CREATE, PERMISSIONS.REQUEST_APPROVE, PERMISSIONS.REQUEST_VOID, PERMISSIONS.SUPPLIER_PROPOSE, PERMISSIONS.SUPPLIER_HOMOLOGATE, PERMISSIONS.SUPPLIER_BANK_VIEW, PERMISSIONS.BUDGET_MANAGE, PERMISSIONS.ACCOUNTING_PROCESS, PERMISSIONS.PERIOD_MANAGE, PERMISSIONS.TREASURY_SCHEDULE, PERMISSIONS.TREASURY_FILE, PERMISSIONS.PAYMENT_CONFIRM, PERMISSIONS.RECONCILE, PERMISSIONS.MASTER_DATA_MANAGE, PERMISSIONS.BANK_FILE_VERIFY, PERMISSIONS.BANK_FORMAT_CERTIFY]) {
    assert.equal(hasPermission(ROLES.SUPER_ADMIN, permission), false, permission);
  }
  const superAdmin = { _id: "sa", role: ROLES.SUPER_ADMIN };
  assert.equal(canApproveStage({ approvalStage: APPROVAL_STAGES.AREA_DIRECTOR }, superAdmin), false);
  assert.equal(canModifyRequest({ requester: "sa", status: REQUEST_STATUS.DRAFT }, superAdmin), false);

  // Route guards: reads pass wherever an Admin passes, writes never do.
  const pass = (middleware, method) => { try { middleware({ user: superAdmin, method }, {}, () => {}); return true; } catch (error) { if (error.statusCode === 403) return false; throw error; } };
  assert.equal(pass(authorize(ROLES.ADMIN, ROLES.TREASURY), "GET"), true);
  assert.equal(pass(authorize(ROLES.ADMIN, ROLES.TREASURY), "POST"), false);
  assert.equal(pass(authorize(ROLES.MANAGEMENT), "GET"), false, "not where an Admin is refused");
  assert.equal(pass(authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), "GET"), true);
  assert.equal(pass(authorizePermission(PERMISSIONS.BANK_FILE_VERIFY), "POST"), false);
  assert.equal(superAdminMayCall("GET", "/api/requests"), true);
  assert.equal(superAdminMayCall("GET", "/api/sire/export"), false, "official exports record history");
  assert.equal(superAdminMayCall("GET", "/api/accounting/consolidation/export"), false);
  assert.equal(superAdminMayCall("GET", "/api/SIRE/Export"), false, "routes are case-insensitive, so is the check");
  assert.equal(superAdminMayCall("GET", "/api/sire/export/"), false);
  assert.equal(superAdminMayCall("POST", "/api/requests"), false);
  assert.equal(superAdminMayCall("PATCH", "/api/notifications/abc/read"), true);
  assert.equal(superAdminMayCall("POST", "/api/superadmin/administrators"), true);
  assert.equal(superAdminMayCall("PUT", "/api/users/me/leave"), false, "the Super Admin is outside the approval hierarchy");

  assert.equal(securityAlertKind({ entityType: "AccountingPeriod", action: "REOPENED" }), "PERIOD_REOPENED");
  assert.equal(securityAlertKind({ module: "AUTH", action: "ACCOUNT_LOCKED", role: ROLES.ADMIN }), "ADMIN_ACCOUNT_LOCKED");
  assert.equal(securityAlertKind({ module: "AUTH", action: "ACCOUNT_LOCKED", role: ROLES.SOLICITOR }), null);
  assert.equal(securityAlertKind({ entityType: "CostCenter", module: "MASTER_DATA", action: "UPDATED" }), null);
});

test("Super Admin accounts never join the approval hierarchy", async () => {
  const user = new User({ name: "SA", dni: "70000001", passwordHash: "x", role: ROLES.SUPER_ADMIN, permissions: [PERMISSIONS.REQUEST_CREATE], approvalAreas: ["*"], jefe: new mongoose.Types.ObjectId() });
  const error = await user.validate().then(() => null, (caught) => caught);
  assert.deepEqual(Object.keys(error.errors).sort(), ["approvalAreas", "jefe", "permissions"]);
});

test("Super Admin: sign-in with authenticator, administrator accounts, oversight, alerts and settings", { timeout: 120000 }, async (t) => {
  const database = `erp_super_admin_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  clearPlatformSettingsCache();
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "uma-backup-"));
  const previousBackupDir = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = backupDir;
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (route, { token, method = "GET", body } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const signIn = async (dni, password = PASSWORD) => (await call("/auth/login", { method: "POST", body: { dni, password } })).body;
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const admin = await User.create({ name: "Main Admin", dni: "70000010", passwordHash, role: ROLES.ADMIN, area: "Systems", passwordChangedAt: new Date() });
    const solicitor = await User.create({ name: "Requester One", dni: "70000011", passwordHash, role: ROLES.SOLICITOR, area: "Operations", passwordChangedAt: new Date() });
    const adminToken = (await signIn("70000010")).token;
    let superToken;
    let superAdminId;
    let secret;

    await t.test("a Super Admin is created only from the server, at most two", async () => {
      const created = await createSuperAdmin({ dni: "70000001", name: "Super One" });
      superAdminId = created.user._id;
      assert.ok(created.password.length >= 10);
      assert.equal(created.user.passwordResetRequired, true);
      await assert.rejects(() => createSuperAdmin({ dni: "70000010", name: "Duplicate" }), /already exists/, "a working account cannot double as the Super Admin");
      await createSuperAdmin({ dni: "70000002", name: "Super Two" });
      await assert.rejects(() => createSuperAdmin({ dni: "70000003", name: "Super Three" }), new RegExp(`${MAX_SUPER_ADMINS} active`));
      await User.updateOne({ _id: superAdminId }, { $set: { passwordHash, passwordResetRequired: false } });
      assert.equal((await call("/users", { method: "POST", token: adminToken, body: { name: "X", dni: "70000099", password: PASSWORD, role: ROLES.SUPER_ADMIN } })).status, 403);
    });

    await t.test("first sign-in requires setting up the authenticator app", async () => {
      const session = await signIn("70000001");
      assert.ok(session.token);
      assert.equal(session.user.twoFactorSetupRequired, true);
      const blocked = await call("/superadmin/overview", { token: session.token });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, "TWO_FACTOR_SETUP_REQUIRED");
      const setup = await call("/auth/two-factor/setup", { method: "POST", token: session.token });
      assert.equal(setup.status, 200);
      secret = setup.body.data.secret;
      assert.match(setup.body.data.otpauthUri, /^otpauth:\/\/totp\//);
      assert.equal((await call("/auth/two-factor/enable", { method: "POST", token: session.token, body: { code: "000000" } })).status, 422);
      const enabled = await call("/auth/two-factor/enable", { method: "POST", token: session.token, body: { code: totpCode(secret) } });
      assert.equal(enabled.status, 200);
      assert.equal(enabled.body.user.twoFactorEnabled, true);
      assert.equal((await call("/auth/me", { token: session.token })).status, 401, "enrolling signs out every older session");
      const stored = await User.findById(superAdminId).lean();
      assert.ok(stored.twoFactor.secret && !stored.twoFactor.secret.includes(secret), "the secret is stored encrypted");
      assert.equal(JSON.stringify(enabled.body).includes(stored.twoFactor.secret), false);
    });

    await t.test("sign-in asks for the authenticator code, refuses a wrong or replayed one", async () => {
      const first = await signIn("70000001");
      assert.equal(first.twoFactorRequired, true);
      assert.equal(first.token, undefined, "no session before the code");
      const wrong = await call("/auth/login/two-factor", { method: "POST", body: { challengeToken: first.challengeToken, code: "123456" === totpCode(secret) ? "654321" : "123456" } });
      assert.equal(wrong.status, 401);
      assert.ok(await AuditLog.exists({ action: "TWO_FACTOR_FAILED", entityId: superAdminId }));
      // The enrolment used the current code; the next one is already accepted (clock-drift window).
      const nextStep = (await User.findById(superAdminId).lean()).twoFactor.lastUsedStep + 1;
      assert.ok(nextStep <= totpStep() + 1);
      const code = totpCode(secret, nextStep);
      const ok = await call("/auth/login/two-factor", { method: "POST", body: { challengeToken: first.challengeToken, code } });
      assert.equal(ok.status, 200);
      superToken = ok.body.token;
      const replay = await call("/auth/login/two-factor", { method: "POST", body: { challengeToken: (await signIn("70000001")).challengeToken, code } });
      assert.equal(replay.status, 401, "a used code cannot be replayed");
      const lifetime = (new Date(ok.body.expiresAt).getTime() - Date.now()) / 60000;
      assert.ok(lifetime > 55 && lifetime <= 60, "Super Admin sessions are shorter (60 minutes by default)");
      assert.ok((await User.findById(superAdminId).lean()).lastLoginAt);
    });

    await t.test("reads what an Admin reads, never writes to a process", async () => {
      for (const route of ["/requests", "/users", "/suppliers", "/accounting-periods", "/treasury/queue", "/accounting/bank-files", "/approvals/inbox", "/reports/management", "/operations/health"]) {
        assert.equal((await call(route, { token: superToken })).status, 200, route);
      }
      const users = await call("/users", { token: superToken });
      assert.ok(users.body.data.some((row) => row.role === ROLES.SUPER_ADMIN), "the Super Admin sees Super Admin accounts");
      const adminUsers = await call("/users", { token: adminToken });
      assert.equal(adminUsers.body.data.some((row) => row.role === ROLES.SUPER_ADMIN), false, "Admins do not");
      for (const [method, route] of [["POST", "/requests"], ["POST", "/accounting-periods"], ["PUT", `/users/${solicitor._id}`], ["DELETE", `/users/${solicitor._id}`], ["POST", "/approvals/bulk"], ["POST", "/treasury/bank-file"], ["PUT", "/users/me/leave"]]) {
        const response = await call(route, { method, token: superToken, body: {} });
        assert.equal(response.status, 403, `${method} ${route}`);
        assert.equal(response.body.code, "READ_ONLY_ROLE", `${method} ${route}`);
      }
      assert.equal((await call("/sire/export?period=2026-09&format=txt", { token: superToken })).status, 403);
      assert.equal((await call("/SIRE/Export?period=2026-09&format=txt", { token: superToken })).status, 403, "a different letter case reaches the same route and is refused too");
      assert.equal((await call("/REQUESTS", { method: "POST", token: superToken, body: {} })).body.code, "READ_ONLY_ROLE");
      const tasks = await call("/dashboard/tasks", { token: superToken });
      assert.deepEqual(tasks.body, { items: [], total: 0, counters: {} });
      assert.equal((await call("/superadmin/overview", { token: adminToken })).status, 403, "the console is the Super Admin's only");
      const overview = await call("/superadmin/overview", { token: superToken });
      assert.equal(overview.status, 200);
      assert.equal(overview.body.data.administrators.activeAdmins, 1);
      assert.ok(Array.isArray(overview.body.data.workload));
    });

    let newAdminId;
    await t.test("only the Super Admin manages administrator accounts", async () => {
      assert.equal((await call("/users", { method: "POST", token: adminToken, body: { name: "Other Admin", dni: "70000020", password: PASSWORD, role: ROLES.ADMIN } })).status, 403, "an Admin cannot create an Admin");
      const created = await call("/superadmin/administrators", { method: "POST", token: superToken, body: { name: "Second Admin", dni: "70000020", email: "second.admin@test.local", area: "Finance" } });
      assert.equal(created.status, 201);
      newAdminId = created.body.data._id;
      const temporary = created.body.temporaryPassword;
      const firstSession = await signIn("70000020", temporary);
      assert.equal(firstSession.user.passwordResetRequired, true);
      assert.ok(await AuditLog.exists({ action: "ADMIN_CREATED", entityId: new mongoose.Types.ObjectId(newAdminId) }));
      assert.equal(JSON.stringify(await AuditLog.find({ action: "ADMIN_CREATED" }).lean()).includes(temporary), false, "the password is never audited");

      // An Admin edits an Admin's place in the organization, not who they are.
      const identity = await call(`/users/${newAdminId}`, { method: "PUT", token: adminToken, body: { name: "Renamed", role: ROLES.ADMIN } });
      assert.equal(identity.status, 403);
      assert.equal(identity.body.code, "ADMIN_ACCOUNT_PROTECTED");
      assert.equal((await call(`/users/${newAdminId}`, { method: "PUT", token: adminToken, body: { password: "Another-Password-1!" } })).status, 403);
      assert.equal((await call(`/users/${newAdminId}`, { method: "DELETE", token: adminToken })).status, 403);
      assert.equal((await call(`/users/${newAdminId}`, { method: "PUT", token: adminToken, body: { name: "Second Admin", role: ROLES.ADMIN, jobTitle: "IT lead", jefe: String(admin._id) } })).status, 200, "unchanged identity plus organization fields is fine");
      assert.equal((await call(`/users/${solicitor._id}`, { method: "PUT", token: adminToken, body: { role: ROLES.ADMIN } })).status, 403, "an Admin cannot promote");
      assert.equal((await call(`/users/${solicitor._id}`, { method: "PUT", token: adminToken, body: { jefe: String(superAdminId) } })).status, 422, "the Super Admin is nobody's jefe");

      const edited = await call(`/superadmin/administrators/${newAdminId}`, { method: "PUT", token: superToken, body: { name: "Second Admin", email: "second@test.local", area: "Treasury" } });
      assert.equal(edited.body.data.email, "second@test.local");
      const reset = await call(`/superadmin/administrators/${newAdminId}/reset-password`, { method: "POST", token: superToken });
      assert.equal(reset.status, 200);
      assert.ok((await signIn("70000020", reset.body.temporaryPassword)).token);
      assert.equal((await call(`/superadmin/administrators/${superAdminId}/reset-password`, { method: "POST", token: superToken })).status, 403, "Super Admin rows are read-only");

      await User.updateOne({ _id: newAdminId }, { $set: { lockedUntil: new Date(Date.now() + 600000), failedLoginAttempts: 0 } });
      const listed = await call("/superadmin/administrators", { token: superToken });
      assert.equal(listed.body.data.find((row) => row._id === newAdminId).locked, true);
      await call(`/superadmin/administrators/${newAdminId}/unlock`, { method: "POST", token: superToken });
      assert.equal((await User.findById(newAdminId).lean()).lockedUntil, null);
      const before = (await User.findById(newAdminId).lean()).tokenVersion;
      await call(`/superadmin/administrators/${newAdminId}/sign-out`, { method: "POST", token: superToken });
      assert.equal((await User.findById(newAdminId).lean()).tokenVersion, before + 1);
      const activity = await call(`/superadmin/administrators/${admin._id}/activity`, { token: superToken });
      assert.ok(activity.body.data.signIns.some((row) => row.action === "LOGIN_SUCCEEDED"));
      assert.ok(activity.body.data.changes.length > 0, "the Admin's own changes are listed");
    });

    await t.test("at least one active administrator always remains", async () => {
      assert.equal((await call(`/superadmin/administrators/${newAdminId}/deactivate`, { method: "POST", token: superToken })).status, 200);
      const last = await call(`/superadmin/administrators/${admin._id}/deactivate`, { method: "POST", token: superToken });
      assert.equal(last.status, 409);
      assert.equal(last.body.code, "LAST_ADMIN");
      assert.equal((await call(`/superadmin/administrators/${admin._id}/demote`, { method: "POST", token: superToken, body: { role: ROLES.SOLICITOR } })).status, 409);
      assert.equal((await call(`/superadmin/administrators/${newAdminId}/activate`, { method: "POST", token: superToken })).status, 200);
    });

    await t.test("promote a user to Admin and demote them back to their earlier role", async () => {
      const candidates = await call("/superadmin/administrators/promotion-candidates?search=Requester", { token: superToken });
      assert.deepEqual(candidates.body.data.map((row) => row.dni), ["70000011"]);
      const promoted = await call("/superadmin/administrators/promote", { method: "POST", token: superToken, body: { userId: String(solicitor._id) } });
      assert.equal(promoted.body.data.role, ROLES.ADMIN);
      assert.equal(promoted.body.data.previousRole, ROLES.SOLICITOR);
      const demoted = await call(`/superadmin/administrators/${solicitor._id}/demote`, { method: "POST", token: superToken, body: {} });
      assert.equal(demoted.body.data.role, ROLES.SOLICITOR);
      assert.equal((await User.findById(solicitor._id).lean()).previousRole, undefined);
    });

    await t.test("sensitive Admin changes alert every active Super Admin", async () => {
      await call(`/users/${solicitor._id}`, { method: "PUT", token: adminToken, body: { permissions: [PERMISSIONS.REPORT_VIEW] } });
      await call("/users", { method: "POST", token: adminToken, body: { name: "New Accountant", dni: "70000030", password: PASSWORD, role: ROLES.ACCOUNTING } });
      const closed = await AccountingPeriod.create({ period: "2026-08", status: "CLOSED" });
      assert.equal((await call(`/accounting-periods/${closed._id}/reopen`, { method: "POST", token: adminToken, body: { comments: "Late invoice" } })).status, 200);
      const alerts = await call("/superadmin/alerts", { token: superToken });
      assert.deepEqual(alerts.body.data.map((row) => row.kind).sort(), ["FINANCE_ROLE_ASSIGNED", "PERIOD_REOPENED", "PERMISSIONS_CHANGED"]);
      const bell = await Notification.find({ user: superAdminId, type: "SECURITY_ALERT" }).lean();
      assert.equal(bell.length, 3);
      assert.ok(bell.some((item) => item.message === "Main Admin reopened accounting period 2026-08."));
      assert.ok(bell.every((item) => item.path.startsWith("/super-admin/alerts?record=")));
      const superTwo = await User.findOne({ dni: "70000002" });
      assert.equal(await Notification.countDocuments({ user: superTwo._id, type: "SECURITY_ALERT" }), 3, "every active Super Admin is alerted");
      assert.equal(await Notification.countDocuments({ user: admin._id, type: "SECURITY_ALERT" }), 0);
      // Notifications are the Super Admin's own: marking them read is allowed.
      assert.equal((await call(`/notifications/${bell[0]._id}/read`, { method: "PATCH", token: superToken })).status, 200);
    });

    await t.test("audit log filtered by administrator", async () => {
      const facets = await call("/superadmin/audit/facets", { token: superToken });
      assert.ok(facets.body.data.modules.includes("USER_ADMIN"));
      const byAdmin = await call(`/superadmin/audit?actor=${admin._id}&module=USER_ADMIN`, { token: superToken });
      assert.ok(byAdmin.body.data.length >= 2);
      assert.ok(byAdmin.body.data.every((row) => String(row.actor) === String(admin._id) && row.module === "USER_ADMIN"));
      assert.equal((await call("/superadmin/audit?from=yesterday", { token: superToken })).status, 422);
    });

    await t.test("platform settings: password policy, maintenance mode and announcement", async () => {
      const saved = await call("/superadmin/settings", { method: "PUT", token: superToken, body: { passwordPolicy: { minLength: 14 }, maintenance: { enabled: true, message: "Closing the month" }, announcement: { enabled: true, message: "New version tonight", tone: "warning" } } });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.data.passwordPolicy.minLength, 14);
      assert.equal((await call("/superadmin/settings", { method: "PUT", token: superToken, body: { passwordPolicy: { minLength: 5 } } })).status, 422);
      const status = await call("/auth/platform-status");
      assert.equal(status.body.data.maintenance.enabled, true);
      assert.equal(status.body.data.announcement.message, "New version tonight");
      const blocked = await call("/auth/login", { method: "POST", body: { dni: "70000011", password: PASSWORD } });
      assert.equal(blocked.status, 503);
      assert.equal(blocked.body.code, "MAINTENANCE_MODE");
      assert.equal((await call("/requests", { token: adminToken })).status, 200, "administrators keep working during maintenance");
      assert.equal((await call("/users", { method: "POST", token: adminToken, body: { name: "Short", dni: "70000040", password: "Twelve-chars", role: ROLES.SOLICITOR } })).status, 422, "the new minimum length applies");
      assert.ok(await AuditLog.exists({ action: "MAINTENANCE_STARTED" }));
      await call("/superadmin/settings", { method: "PUT", token: superToken, body: { maintenance: { enabled: false } } });
      assert.ok((await signIn("70000011")).token, "sign-in works again");
    });

    await t.test("password expiry forces a change at the next sign-in", async () => {
      await call("/superadmin/settings", { method: "PUT", token: superToken, body: { passwordPolicy: { expiryDays: 30 } } });
      await User.updateOne({ _id: solicitor._id }, { $set: { passwordChangedAt: new Date(Date.now() - 40 * 86400000) } });
      const session = await signIn("70000011");
      assert.equal(session.user.passwordResetRequired, true);
      assert.equal(session.user.passwordExpired, true);
      assert.equal((await call("/requests", { token: session.token })).body.code, "PASSWORD_CHANGE_REQUIRED");
      const changed = await call("/auth/change-password", { method: "POST", token: session.token, body: { currentPassword: PASSWORD, newPassword: "Brand-New-Password-1!" } });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.user.passwordResetRequired, false);
      await call("/superadmin/settings", { method: "PUT", token: superToken, body: {} });
    });

    await t.test("a backup can be started and followed from the console", async () => {
      const started = await call("/superadmin/backups", { method: "POST", token: superToken });
      assert.equal(started.status, 202);
      let run;
      for (let attempt = 0; attempt < 100; attempt++) {
        run = await BackupRun.findById(started.body.data._id).lean();
        if (run.status !== "RUNNING") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(run.status, "SUCCEEDED", run.error);
      assert.ok(run.collections.some((item) => item.name === "users"));
      await fs.access(path.join(run.location, "manifest.json"));
      const history = await call("/superadmin/backups", { token: superToken });
      assert.equal(history.body.data[0].status, "SUCCEEDED");
    });

    await t.test("a lost phone is handled from the server", async () => {
      await resetSuperAdminTwoFactor({ dni: "70000001" });
      assert.equal((await call("/superadmin/overview", { token: superToken })).status, 401, "existing sessions end");
      const session = await signIn("70000001");
      assert.equal(session.user.twoFactorSetupRequired, true);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    clearPlatformSettingsCache();
    if (previousBackupDir === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = previousBackupDir;
    await fs.rm(backupDir, { recursive: true, force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
