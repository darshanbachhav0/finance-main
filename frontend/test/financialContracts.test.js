import assert from "node:assert/strict";
import { canAccessNavigation, visibleNavigationPaths } from "../src/utils/navigationAccess.js";
import {
  expenseNatures,
  requestStatuses,
  requestTypes,
  roles
} from "../src/utils/options.js";
import { buildRemoteTableParams } from "../src/utils/tableQuery.js";

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

test("canonical request statuses contain the complete lifecycle", () => {
  for (const status of [
    "BORRADOR", "EN_VALIDACION", "ENVIADO", "PENDIENTE_APROBACION",
    "APROBADO_DIRECTOR", "APROBADO_VICERRECTOR", "COMPROMISO_PRESUPUESTAL",
    "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO",
    "RENDICION_PENDIENTE", "CERRADO", "OBSERVADO", "DEVUELTO", "RECHAZADO", "ANULADO"
  ]) assert.ok(requestStatuses.includes(status), `Missing status ${status}`);

  for (const legacy of ["APROBADO_POR_PAGAR", "PROCESADO_BANCO", "LIQUIDADO_CERRADO"])
    assert.equal(requestStatuses.includes(legacy), false, `Legacy status ${legacy} must not drive the UI`);
});

test("request type and expense nature are separate controlled taxonomies", () => {
  assert.deepEqual(requestTypes, [
    "OPEX", "CAPEX", "ENTREGA_RENDIR", "REEMBOLSO_CON_SUSTENTO",
    "REEMBOLSO_SIN_SUSTENTO", "PAGO_CON_COTIZACION"
  ]);
  assert.ok(expenseNatures.includes("GOODS"));
  assert.ok(expenseNatures.includes("PROFESSIONAL_FEES"));
  assert.equal(expenseNatures.includes("OPEX"), false);
});

test("all required functional profiles are available", () => {
  assert.deepEqual(roles, ["Admin", "Solicitor", "Approver", "Accounting", "Treasury", "Budget", "Management"]);
});

test("solicitor navigation exposes work entry but no privileged finance modules", () => {
  const paths = visibleNavigationPaths("Solicitor");
  assert.ok(paths.includes("/requests"));
  assert.ok(paths.includes("/suppliers"));
  assert.equal(paths.includes("/accounting"), false);
  assert.equal(paths.includes("/treasury"), false);
  assert.equal(paths.includes("/audit"), false);
});

test("Treasury can use payment and reporting screens without supplier maintenance privileges", () => {
  assert.equal(canAccessNavigation("Treasury", "/treasury"), true);
  assert.equal(canAccessNavigation("Treasury", "/reports"), true);
  assert.equal(canAccessNavigation("Treasury", "/suppliers"), true);
  assert.equal(canAccessNavigation("Treasury", "/accounting"), false);
  assert.equal(canAccessNavigation("Treasury", "/users"), false);
});

test("Admin receives every navigation destination", () => {
  assert.ok(visibleNavigationPaths("Admin").length >= 16);
  assert.equal(canAccessNavigation("Admin", "/audit"), true);
});

test("server table queries retain paging, filters, and sorting without empty parameters", () => {
  assert.deepEqual(buildRemoteTableParams({
    page: 3,
    pageSize: 25,
    search: "  SOL-2026  ",
    filters: { status: "PAGADO", currency: "", active: false },
    sort: { key: "createdAt", direction: "desc" }
  }, { period: "2026-08" }), {
    period: "2026-08",
    page: 3,
    pageSize: 25,
    search: "SOL-2026",
    status: "PAGADO",
    active: false,
    sortBy: "createdAt",
    sortDirection: "desc"
  });
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} financial frontend contract tests passed.`);
