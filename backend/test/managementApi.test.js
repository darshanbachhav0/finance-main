import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { managementOpenApi } from "../src/docs/managementOpenApi.js";
import { assertSafeManagementPayload, managementEnvelope, parseManagementFilters } from "../src/services/externalManagementService.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import { createUser } from "../src/controllers/userController.js";
import User from "../src/models/User.js";
import { MANAGEMENT_VIEWER_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../src/utils/constants.js";
import { hasPermission, permissionsFor } from "../src/utils/permissions.js";

test("ManagementViewer is portal-only: the management-portal permission and nothing else", () => {
  assert.deepEqual(ROLE_PERMISSIONS[ROLES.MANAGEMENT_VIEWER], [PERMISSIONS.MANAGEMENT_PORTAL_VIEW]);
  assert.deepEqual(MANAGEMENT_VIEWER_PERMISSIONS, [PERMISSIONS.MANAGEMENT_PORTAL_VIEW]);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
  for (const permission of Object.values(PERMISSIONS)) {
    if (permission === PERMISSIONS.MANAGEMENT_PORTAL_VIEW) continue;
    assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, permission), false, `ManagementViewer must not have ${permission}`);
  }
  // A stored extra grant (legacy data) never widens the role.
  const legacyViewer = { role: ROLES.MANAGEMENT_VIEWER, permissions: [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REQUEST_APPROVE, PERMISSIONS.USER_MANAGE] };
  assert.deepEqual(permissionsFor(legacyViewer), [PERMISSIONS.MANAGEMENT_PORTAL_VIEW]);
  // Other roles keep additive custom permissions (grantable ones only).
  assert.equal(hasPermission({ role: ROLES.BUDGET, permissions: [PERMISSIONS.REQUEST_CREATE] }, PERMISSIONS.REQUEST_CREATE), true);
  assert.equal(hasPermission({ role: ROLES.BUDGET, permissions: [PERMISSIONS.AUDIT_VIEW] }, PERMISSIONS.AUDIT_VIEW), false);
  assert.equal(hasPermission(ROLES.MANAGEMENT, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
});

test("a ManagementViewer can never be saved with any other permission", async () => {
  const viewer = new User({ name: "Viewer", dni: "44444444", passwordHash: "unused", role: ROLES.MANAGEMENT_VIEWER, permissions: [PERMISSIONS.REQUEST_APPROVE] });
  const error = await viewer.validate().then(() => null, (caught) => caught);
  assert.equal(error?.name, "ValidationError");
  assert.match(error.errors.permissions.message, /request:approve/);
  await new User({ name: "Viewer", dni: "44444445", passwordHash: "unused", role: ROLES.MANAGEMENT_VIEWER, permissions: [PERMISSIONS.MANAGEMENT_PORTAL_VIEW] }).validate();
  await new User({ name: "Budget", dni: "44444446", passwordHash: "unused", role: ROLES.BUDGET, permissions: [PERMISSIONS.AUDIT_VIEW] }).validate();

  const res = { status() { return this; }, json() { return this; } };
  let caught;
  await createUser({ user: { _id: "admin" }, body: { name: "Viewer", dni: "44444447", password: "Long-Enough-1!", role: ROLES.MANAGEMENT_VIEWER, permissions: [PERMISSIONS.REPORT_VIEW] } }, res, (err) => { caught = err; });
  assert.equal(caught?.statusCode, 422);
  assert.deepEqual(caught.details.disallowed, [PERMISSIONS.REPORT_VIEW]);
});

test("management filters accept bounded reporting scopes and reject query-shaped values", () => {
  assert.deepEqual(parseManagementFilters({ period: "2026-09", area: "Tesorería", dateFrom: "2026-09-01", dateTo: "2026-09-30" }), {
    period: "2026-09", area: "Tesorería", dateFrom: "2026-09-01", dateTo: "2026-09-30"
  });
  assert.throws(() => parseManagementFilters({ period: "2026-13" }), /period/);
  assert.throws(() => parseManagementFilters({ dateFrom: "09-01-2026" }), /dateFrom/);
  assert.throws(() => parseManagementFilters({ dateFrom: "2026-02-31" }), /dateFrom/);
  assert.throws(() => parseManagementFilters({ dateFrom: "2026-10-01", dateTo: "2026-09-01" }), /dateFrom/);
  assert.throws(() => parseManagementFilters({ area: "$where" }), /area/);
});

test("internal API gate is mounted after the external management API and excludes ManagementViewer", () => {
  const source = fs.readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  const managementIndex = source.indexOf('router.use("/management/v1", externalManagementRoutes)');
  const internalGateIndex = source.indexOf("router.use(protect, authorize(");
  const requestIndex = source.indexOf('router.use("/requests", requestRoutes)');
  assert.ok(managementIndex >= 0 && internalGateIndex > managementIndex && requestIndex > internalGateIndex);
  const gateClause = source.slice(internalGateIndex, source.indexOf(";", internalGateIndex));
  assert.match(gateClause, /ROLES\.MANAGEMENT\b/);
  // Portal-only: the viewer never passes the internal gate (no Reports, dashboards, audit, requests).
  assert.equal(gateClause.includes("ROLES.MANAGEMENT_VIEWER"), false);
  for (const file of ["reportRoutes.js", "requestRoutes.js", "dashboardRoutes.js"]) {
    const routeSource = fs.readFileSync(new URL(`../src/routes/${file}`, import.meta.url), "utf8");
    assert.equal(/authorize\([^)]*ROLES\.MANAGEMENT_VIEWER/.test(routeSource), false, `${file} must not admit ManagementViewer`);
  }
});

test("ManagementViewer reaches the portal API but is refused internal reports over HTTP", { timeout: 60000 }, async () => {
  const database = `erp_management_viewer_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  try {
    const viewer = await User.create({ name: "Portal viewer", dni: "55555555", passwordHash: "unused", role: ROLES.MANAGEMENT_VIEWER });
    const management = await User.create({ name: "Management", dni: "55555556", passwordHash: "unused", role: ROLES.MANAGEMENT });
    const token = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
    const get = async (path, user) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { Authorization: `Bearer ${token(user)}` } })).status;
    assert.equal(await get("/management/v1/overview", viewer), 200);
    for (const path of ["/reports/management", "/reports/management/export", "/reports/management/exports", "/dashboard/summary", "/dashboard/tasks", "/requests", "/notifications"]) {
      assert.equal(await get(path, viewer), 403, `${path} is internal`);
    }
    assert.equal(await get("/reports/management", management), 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("management response guard blocks transaction and identity fields", () => {
  const safe = { pendingRequests: 3, paidThisMonth: { count: 2, amountPEN: 2500 }, byArea: [{ key: "Finance", count: 2 }] };
  assert.doesNotThrow(() => assertSafeManagementPayload(safe));
  assert.equal(managementEnvelope(safe, { period: "2026" }, new Date("2026-09-18T12:00:00.000Z")).apiVersion, "1.0");
  for (const payload of [{ supplierName: "Hidden" }, { nested: { ruc: "20123456789" } }, { requestNumber: "REQ-2026-1" }, { accountNumber: "001" }, { fileName: "evidence.pdf" }]) {
    assert.throws(() => assertSafeManagementPayload(payload), /Unsafe management API field/);
  }
});

test("OpenAPI exposes versioned read-only management resources", () => {
  assert.equal(managementOpenApi.openapi, "3.1.0");
  for (const section of ["overview", "budget", "workflow", "payments", "sla", "filters", "openapi.json"]) {
    assert.ok(managementOpenApi.paths[`/management/v1/${section}`]?.get);
  }
  for (const [path, item] of Object.entries(managementOpenApi.paths)) {
    if (path === "/auth/login") continue;
    assert.deepEqual(Object.keys(item), ["get"], `${path} remains read-only`);
  }
});
