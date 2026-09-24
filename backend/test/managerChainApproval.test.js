import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import {
  activeApprovalStep,
  activateNextChainStep,
  finalizeChainApproval,
  initializeApprovalRoute,
  resolveManagerChain
} from "../src/services/approvalRuleService.js";
import { APPROVAL_ROUTING_MODE } from "../src/utils/constants.js";

async function makeUser(overrides = {}) {
  return User.create({
    name: overrides.name || "Test User",
    dni: overrides.dni,
    passwordHash: "not-a-real-hash",
    role: "Solicitor",
    ...overrides
  });
}

test("manager-chain approval routing", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_manager_chain_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await t.test("a requester with no jefe falls back to the rule-based route", async () => {
      const requester = await makeUser({ dni: "90000001", name: "No Manager" });
      const route = await resolveManagerChain({ requester: requester._id });
      assert.equal(route, null);
    });

    await t.test("initializeApprovalRoute picks the manager chain when the requester has a jefe", async () => {
      const jefe = await makeUser({ dni: "90000002", name: "Direct Manager", jobTitle: "Area Lead" });
      const requester = await makeUser({ dni: "90000003", name: "Reports To Jefe", jefe: jefe._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      assert.equal(request.approvalRoutingMode, APPROVAL_ROUTING_MODE.MANAGER_CHAIN);
      assert.equal(request.approvalRouteSnapshot.length, 1);
      const step = request.approvalRouteSnapshot[0];
      assert.equal(String(step.approverUser), String(jefe._id));
      assert.equal(step.source, APPROVAL_ROUTING_MODE.MANAGER_CHAIN);
      assert.equal(step.status, "PENDING");
      assert.equal(step.approverSnapshot.name, "Direct Manager");
    });

    await t.test("the full multi-level chain is resolved and frozen at submission, not built one hop at a time", async () => {
      const root = await makeUser({ dni: "90000010", name: "Root" });
      const mid = await makeUser({ dni: "90000011", name: "Middle Manager", jefe: root._id });
      const requester = await makeUser({ dni: "90000012", name: "Bottom Requester", jefe: mid._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);

      // Both levels exist in the snapshot immediately — root's identity is
      // already frozen even though the request has not escalated to it yet.
      assert.equal(request.approvalRouteSnapshot.length, 2);
      assert.equal(String(request.approvalRouteSnapshot[0].approverUser), String(mid._id));
      assert.equal(request.approvalRouteSnapshot[0].status, "PENDING");
      assert.equal(String(request.approvalRouteSnapshot[1].approverUser), String(root._id));
      assert.equal(request.approvalRouteSnapshot[1].status, "NOT_REACHED");

      let step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(mid._id));

      const forwardResult = activateNextChainStep(request, step, mid);
      assert.equal(forwardResult.complete, false);
      assert.equal(request.approvalRouteSnapshot.length, 2, "forwarding activates the pre-existing step, it never appends a new one");
      assert.equal(request.approvalRouteSnapshot[0].status, "APPROVED");
      assert.equal(request.approvalRouteSnapshot[1].status, "PENDING");

      step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(root._id));

      const finalResult = finalizeChainApproval(request, step, root);
      assert.equal(finalResult.complete, true);
      assert.equal(activeApprovalStep(request), undefined);
    });

    await t.test("required hierarchy steps cannot be skipped by early finalization", async () => {
      const root = await makeUser({ dni: "90000015", name: "Skip Root" });
      const mid = await makeUser({ dni: "90000016", name: "Skip Middle", jefe: root._id });
      const requester = await makeUser({ dni: "90000017", name: "Skip Requester", jefe: mid._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      const step = activeApprovalStep(request);
      assert.throws(() => finalizeChainApproval(request, step, mid), error => error.statusCode === 409);
      assert.equal(request.approvalRouteSnapshot[0].status, "PENDING");
      assert.equal(request.approvalRouteSnapshot[1].status, "NOT_REACHED");
    });

    await t.test("the root of the chain cannot forward further", async () => {
      const root = await makeUser({ dni: "90000020", name: "Solo Root" });
      const requester = await makeUser({ dni: "90000021", name: "Reports To Root", jefe: root._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      assert.equal(request.approvalRouteSnapshot.length, 1);
      const step = activeApprovalStep(request);
      assert.throws(
        () => activateNextChainStep(request, step, root),
        (error) => error.statusCode === 422
      );
    });

    await t.test("a cyclical hierarchy blocks submission instead of silently truncating required authority", async () => {
      const top = await makeUser({ dni: "90000030", name: "Top" });
      const middle = await makeUser({ dni: "90000031", name: "Loop Middle", jefe: top._id });
      // A data-entry mistake: the "top" person's jefe is wrongly set back to middle.
      await User.findByIdAndUpdate(top._id, { jefe: middle._id });
      const requester = await makeUser({ dni: "90000032", name: "Loop Requester", jefe: middle._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await assert.rejects(initializeApprovalRoute(request), error => error.statusCode === 422);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
