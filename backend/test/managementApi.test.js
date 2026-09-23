import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { managementOpenApi } from "../src/docs/managementOpenApi.js";
import { assertSafeManagementPayload, managementEnvelope, parseManagementFilters } from "../src/services/externalManagementService.js";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../src/utils/constants.js";
import { hasPermission } from "../src/utils/permissions.js";

test("ManagementViewer has only the aggregate portal permission", () => {
  assert.deepEqual(ROLE_PERMISSIONS[ROLES.MANAGEMENT_VIEWER], [PERMISSIONS.MANAGEMENT_PORTAL_VIEW]);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
  for (const permission of [PERMISSIONS.REQUEST_VIEW_ALL, PERMISSIONS.REQUEST_APPROVE, PERMISSIONS.BUDGET_VIEW, PERMISSIONS.REPORT_VIEW, PERMISSIONS.TREASURY_FILE, PERMISSIONS.AUDIT_VIEW]) {
    assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, permission), false);
  }
  assert.equal(hasPermission(ROLES.MANAGEMENT, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
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

test("internal API gate is mounted after the external management API", () => {
  const source = fs.readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  const managementIndex = source.indexOf('router.use("/management/v1", externalManagementRoutes)');
  const internalGateIndex = source.indexOf("router.use(protect, authorize(");
  const requestIndex = source.indexOf('router.use("/requests", requestRoutes)');
  assert.ok(managementIndex >= 0 && internalGateIndex > managementIndex && requestIndex > internalGateIndex);
  assert.match(source.slice(internalGateIndex, requestIndex), /ROLES\.MANAGEMENT\)/);
  assert.equal(source.slice(internalGateIndex, requestIndex).includes("ROLES.MANAGEMENT_VIEWER"), false);
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
