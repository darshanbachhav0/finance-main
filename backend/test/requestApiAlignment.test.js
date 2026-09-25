import assert from "node:assert/strict";
import test from "node:test";
import { allowedRequestActions } from "../src/services/requestActionPolicy.js";
import { applyRenditionStatusFilter } from "../src/services/requestService.js";

const owner = { _id: "owner", role: "Solicitor", active: true, area: "Operations" };
const director = { _id: "director", role: "AreaDirector", active: true, approvalLevel: "AREA_DIRECTOR", area: "Operations" };
const vice = { _id: "vice", role: "ViceRector", active: true, approvalLevel: "VICE_RECTOR", area: "Management" };
const accounting = { _id: "accounting", role: "Accounting", active: true, area: "Finance" };

function approvalRequest(overrides = {}) {
  return {
    _id: "request",
    requester: owner._id,
    requesterArea: "Operations",
    status: "PENDIENTE_APROBACION",
    approvalStage: "AREA_DIRECTOR",
    approvalRouteSnapshot: [{ sequence: 1, required: true, status: "PENDING", role: "AreaDirector", approvalLevel: "AREA_DIRECTOR" }],
    ...overrides
  };
}

test("renditionStatus builds a direct rendition query and keeps the legacy pending alias", () => {
  assert.deepEqual(applyRenditionStatusFilter({}, "PENDING,SUBMITTED,OBSERVED"), {
    "rendition.status": { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }
  });
  assert.deepEqual(applyRenditionStatusFilter({}, "validated"), {
    "rendition.status": { $in: ["VALIDATED"] }
  });
  assert.deepEqual(applyRenditionStatusFilter({}, "RENDICION_PENDIENTE"), {
    "rendition.status": { $in: ["PENDING", "SUBMITTED", "OBSERVED"] }
  });
});

test("allowedActions follows role, approval stage, route role and ownership", () => {
  const request = approvalRequest();
  assert.deepEqual(allowedRequestActions(request, director), ["APPROVE", "OBSERVE", "RETURN", "REJECT"]);
  assert.deepEqual(allowedRequestActions(request, vice), []);
  assert.deepEqual(allowedRequestActions(request, accounting), []);
  assert.deepEqual(allowedRequestActions(request, owner), []);
  assert.deepEqual(allowedRequestActions({ ...request, requester: director._id }, director), []);
  assert.deepEqual(allowedRequestActions({ ...request, approvalRouteSnapshot: [{ ...request.approvalRouteSnapshot[0], role: "Management" }] }, director), []);
});

test("allowedActions exposes owner editing and finance transitions only when workflow evidence permits", () => {
  assert.deepEqual(allowedRequestActions({ status: "BORRADOR", requester: owner._id }, owner), ["EDIT", "SUBMIT", "DELETE"]);
  assert.ok(allowedRequestActions({ status: "BORRADOR", requester: owner._id }, accounting, { hasActiveObligations: false }).includes("CANCEL"));
  assert.ok(allowedRequestActions({ status: "CONCILIADO", requester: owner._id }, accounting, { closureReady: true }).includes("CLOSE"));
  assert.ok(!allowedRequestActions({ status: "CONCILIADO", requester: owner._id }, accounting, { closureReady: false }).includes("CLOSE"));
});

test("terminal requests return no invalid actions, including historical closure aliases", () => {
  for (const status of ["RECHAZADO", "ANULADO", "CERRADO", "PAGADO_CERRADO"]) {
    assert.deepEqual(allowedRequestActions(approvalRequest({ status }), director), []);
  }
});
