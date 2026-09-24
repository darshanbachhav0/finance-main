import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { managementOpenApi } from "../src/docs/managementOpenApi.js";
import { assertSafeManagementPayload, managementEnvelope, parseManagementFilters } from "../src/services/externalManagementService.js";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../src/utils/constants.js";
import { hasPermission } from "../src/utils/permissions.js";

test("ManagementViewer is read-only: dashboards/reports/audit permissions, never a mutation permission", () => {
  assert.deepEqual(ROLE_PERMISSIONS[ROLES.MANAGEMENT_VIEWER], [PERMISSIONS.MANAGEMENT_PORTAL_VIEW, PERMISSIONS.REPORT_VIEW, PERMISSIONS.AUDIT_VIEW]);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.MANAGEMENT_PORTAL_VIEW), true);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.REPORT_VIEW), true);
  assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, PERMISSIONS.AUDIT_VIEW), true);
  // Every remaining permission is either a write/mutation capability or a broad
  // per-request view the role must not have - none of them should be granted.
  const readOnlyGranted = new Set([PERMISSIONS.MANAGEMENT_PORTAL_VIEW, PERMISSIONS.REPORT_VIEW, PERMISSIONS.AUDIT_VIEW]);
  for (const permission of Object.values(PERMISSIONS)) {
    if (readOnlyGranted.has(permission)) continue;
    assert.equal(hasPermission(ROLES.MANAGEMENT_VIEWER, permission), false, `ManagementViewer must not have ${permission}`);
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

test("internal API gate is mounted after the external management API and admits ManagementViewer read-only", () => {
  const source = fs.readFileSync(new URL("../src/routes/index.js", import.meta.url), "utf8");
  const managementIndex = source.indexOf('router.use("/management/v1", externalManagementRoutes)');
  const internalGateIndex = source.indexOf("router.use(protect, authorize(");
  const requestIndex = source.indexOf('router.use("/requests", requestRoutes)');
  assert.ok(managementIndex >= 0 && internalGateIndex > managementIndex && requestIndex > internalGateIndex);
  const gateClause = source.slice(internalGateIndex, requestIndex);
  assert.match(gateClause, /ROLES\.MANAGEMENT\b/);
  // ManagementViewer is now admitted past the outer gate (it has real, if narrow, internal
  // read-only screens) - but nothing beyond this single blanket gate grants it further access;
  // per-route authorize()/authorizePermission() calls throughout the API still decide what it
  // can actually reach, and it must never appear alongside a write-capable role list there.
  assert.match(gateClause, /ROLES\.MANAGEMENT_VIEWER/);
  const requestRoutesSource = fs.readFileSync(new URL("../src/routes/requestRoutes.js", import.meta.url), "utf8");
  assert.equal(requestRoutesSource.includes("ROLES.MANAGEMENT_VIEWER"), false, "ManagementViewer must not appear on any request-mutation route");
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
