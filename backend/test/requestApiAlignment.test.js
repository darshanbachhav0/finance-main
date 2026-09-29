import assert from "node:assert/strict";
import test from "node:test";
import { allowedRequestActions } from "../src/services/requestActionPolicy.js";
import { applyRenditionStatusFilter, submitFinancialRequest } from "../src/services/requestService.js";
import FinancialRequest from "../src/models/FinancialRequest.js";

const owner = { _id: "owner", role: "Solicitor", active: true, area: "Operations" };
const director = { _id: "director", role: "AreaDirector", active: true, approvalLevel: "AREA_DIRECTOR", area: "Operations" };
const vice = { _id: "vice", role: "ViceRector", active: true, approvalLevel: "VICE_RECTOR", area: "Management" };
const accounting = { _id: "accounting", role: "Accounting", active: true, area: "Finance" };

test("direct submit rejects an issued order before changing approvals or financial data", async t => {
  const request = { _id: "request", requester: owner._id, status: "OBSERVADO_SUNAT", purchaseOrder: "order", approvalStage: "COMPLETE" };
  const before = JSON.stringify(request);
  t.mock.method(FinancialRequest, "findById", () => ({ select: () => ({ populate: async () => request }) }));
  await assert.rejects(submitFinancialRequest({ id: request._id, user: owner }), error => error.statusCode === 409 && error.message.includes("Correct the invoice in Documents"));
  assert.equal(JSON.stringify(request), before);
});

test("invoice observations preserve issued orders and expose invoice correction, not resubmission", () => {
  for (const status of ["OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO"]) {
    const request = { requester: owner._id, flowType: "A1", status, purchaseOrder: "issued-order" };
    for (const user of [owner, accounting, { _id: "admin", role: "Admin" }]) {
      const actions = allowedRequestActions(request, user);
      assert.ok(actions.includes("REGISTER_INVOICE"));
      assert.ok(!actions.includes("EDIT"));
      assert.ok(!actions.includes("SUBMIT"));
    }
    assert.ok(!allowedRequestActions(request, { ...owner, _id: "other" }).includes("REGISTER_INVOICE"));
  }
  assert.ok(allowedRequestActions({ requester: owner._id, status: "OBSERVADO" }, owner).includes("SUBMIT"));
});

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
  // The owner may only withdraw while no approver has approved yet.
  assert.deepEqual(allowedRequestActions(request, owner), ["WITHDRAW"]);
  assert.deepEqual(allowedRequestActions({ ...request, approvalRouteSnapshot: [{ ...request.approvalRouteSnapshot[0], status: "APPROVED" }] }, owner), []);
  assert.deepEqual(allowedRequestActions({ ...request, requester: director._id }, director), ["WITHDRAW"]);
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
