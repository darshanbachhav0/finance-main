import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import {
  activeApprovalStep,
  appendNextChainStep,
  finalizeChainApproval,
  initializeApprovalRoute,
  resolveManagerChainStart
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
      const route = await resolveManagerChainStart({ requester: requester._id });
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

    await t.test("a chain forwards one step at a time up a multi-level hierarchy", async () => {
      const root = await makeUser({ dni: "90000010", name: "Root" });
      const mid = await makeUser({ dni: "90000011", name: "Middle Manager", jefe: root._id });
      const requester = await makeUser({ dni: "90000012", name: "Bottom Requester", jefe: mid._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);

      let step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(mid._id));

      const forwardResult = await appendNextChainStep(request, step, mid);
      assert.equal(forwardResult.complete, false);
      assert.equal(request.approvalRouteSnapshot.length, 2);
      assert.equal(request.approvalRouteSnapshot[0].status, "APPROVED");

      step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(root._id));

      const finalResult = finalizeChainApproval(request, step, root);
      assert.equal(finalResult.complete, true);
      assert.equal(activeApprovalStep(request), undefined);
    });

    await t.test("the root of the chain cannot forward further", async () => {
      const root = await makeUser({ dni: "90000020", name: "Solo Root" });
      const requester = await makeUser({ dni: "90000021", name: "Reports To Root", jefe: root._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      const step = activeApprovalStep(request);
      await assert.rejects(
        () => appendNextChainStep(request, step, root),
        (error) => error.statusCode === 422
      );
    });

    await t.test("forwarding back to an approver already in the route is refused", async () => {
      const top = await makeUser({ dni: "90000030", name: "Top" });
      const middle = await makeUser({ dni: "90000031", name: "Loop Middle", jefe: top._id });
      // A data-entry mistake: the "top" person's jefe is wrongly set back to middle.
      const freshTop = await User.findByIdAndUpdate(top._id, { jefe: middle._id }, { new: true });
      const requester = await makeUser({ dni: "90000032", name: "Loop Requester", jefe: middle._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      let step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(middle._id));
      await appendNextChainStep(request, step, middle);
      step = activeApprovalStep(request);
      assert.equal(String(step.approverUser), String(top._id));
      await assert.rejects(
        () => appendNextChainStep(request, step, freshTop),
        (error) => error.statusCode === 409
      );
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
