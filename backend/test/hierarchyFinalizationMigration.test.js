import assert from "node:assert/strict";
import test from "node:test";
import { planHierarchyFinalization, migrateHierarchyFinalization } from "../scripts/migrateHierarchyFinalization.js";

function fixture() {
  const at = new Date("2026-09-28T21:03:02Z");
  return { requestNumber: "TEST-1", status: "PENDIENTE_APROBACION", approvalRoutingMode: "MANAGER_CHAIN", approvalRouteSnapshot: [
    { source: "MANAGER_CHAIN", sequence: 1, status: "APPROVED", approvalLevel: "Jefe", completedBy: "manager", completedAt: at },
    { source: "RULE_BASED", sequence: 2, status: "PENDING", role: "Approver" }
  ], approvalHistory: [{ action: "Jefe_APPROVED", actor: "manager", stage: "Jefe", createdAt: at }] };
}
test("migration preserves sign-offs and only skips the unfinished legacy tail", () => {
  const request = fixture(), before = JSON.stringify(request);
  const plan = planHierarchyFinalization(request);
  assert.deepEqual(plan.route[0], request.approvalRouteSnapshot[0]);
  assert.equal(plan.route[1].status, "SKIPPED");
  assert.equal(JSON.stringify(request), before);
  assert.equal(planHierarchyFinalization({ ...request, status: "APROBADO", approvalRouteSnapshot: plan.route }), null);
  for (const status of ["RECHAZADO", "ANULADO", "CERRADO", "PAGADO"]) assert.equal(planHierarchyFinalization({ ...request, status }), null);
});
test("missing evidence, forwarding and subsequent decisions require review", () => {
  const request = fixture();
  assert.ok(planHierarchyFinalization({ ...request, approvalHistory: [] }).review);
  request.approvalHistory[0].action = "CHAIN_APPROVED_FORWARDED";
  assert.ok(planHierarchyFinalization(request).review);
  const pending = fixture(); pending.approvalRouteSnapshot[0].status = "PENDING";
  assert.ok(planHierarchyFinalization(pending).review);
});
test("dry run never accesses a write or transaction", async () => {
  const db = { collection(name) { assert.equal(name, "financialrequests"); return { find() { return [fixture()]; } }; } };
  assert.deepEqual(await migrateHierarchyFinalization(db), { mode: "DRY_RUN", ready: ["TEST-1"], manualReview: [] });
});
