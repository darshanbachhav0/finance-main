import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import {
  activeApprovalStep,
  activateNextChainStep,
  dueDate,
  finalizeChainApproval,
  initializeApprovalRoute,
  nextChainApprover,
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
    await t.test("a requester without a jefe requires an explicit supervisor assignment", async () => {
      const requester = await makeUser({ dni: "90000001", name: "No Manager" });
      const route = await resolveManagerChain({ requester: requester._id });
      assert.equal(route, null);
      await assert.rejects(initializeApprovalRoute({ requester: requester._id, flowType: "B" }), error => error.code === "APPROVAL_ROUTE_NOT_CONFIGURED");
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

    // Product decision (flexible chain): at every level the jefe either finalizes
    // or sends the approval to their own jefe; the next level is added only then.
    await t.test("each chain level is added only when the previous jefe forwards it", async () => {
      const root = await makeUser({ dni: "90000010", name: "Root" });
      const mid = await makeUser({ dni: "90000011", name: "Middle Manager", jefe: root._id });
      const requester = await makeUser({ dni: "90000012", name: "Bottom Requester", jefe: mid._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);

      assert.equal(request.approvalRouteSnapshot.length, 1, "only the first jefe is on the route at submission");
      assert.equal(String(request.approvalRouteSnapshot[0].approverUser), String(mid._id));
      assert.equal(request.approvalRouteSnapshot[0].status, "PENDING");
      assert.equal(String((await nextChainApprover(request))._id), String(root._id), "forwarding is offered because mid has a jefe");

      let step = activeApprovalStep(request);
      const forwardResult = await activateNextChainStep(request, step, mid);
      assert.equal(forwardResult.complete, false);
      assert.equal(request.approvalRouteSnapshot.length, 2);
      assert.equal(request.approvalRouteSnapshot[0].status, "APPROVED");
      assert.equal(request.approvalRouteSnapshot[1].status, "PENDING");
      assert.equal(String(request.approvalRouteSnapshot[1].approverUser), String(root._id));

      step = activeApprovalStep(request);
      assert.equal(await nextChainApprover(request), null, "the root has nobody to forward to");
      const finalResult = await finalizeChainApproval(request, step, root);
      assert.equal(finalResult.complete, true);
      assert.equal(activeApprovalStep(request), undefined);
    });

    await t.test("a jefe below the top can finalize the chain", async () => {
      const root = await makeUser({ dni: "90000015", name: "Skip Root" });
      const mid = await makeUser({ dni: "90000016", name: "Skip Middle", jefe: root._id });
      const requester = await makeUser({ dni: "90000017", name: "Skip Requester", jefe: mid._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      const result = await finalizeChainApproval(request, activeApprovalStep(request), mid);
      assert.equal(result.complete, true);
      assert.equal(request.approvalStage, "COMPLETE");
      assert.equal(request.approvalRouteSnapshot.length, 1, "root was never asked, so it is not on the route");
    });

    await t.test("legacy pre-created chain levels become explicit SKIPPED steps when a lower jefe finalizes", async () => {
      const mid = new mongoose.Types.ObjectId(), root = new mongoose.Types.ObjectId();
      const request = { requester: new mongoose.Types.ObjectId(), approvalRouteSnapshot: [
        { approverUser: mid, sequence: 1, required: true, status: "PENDING", source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN },
        { approverUser: root, sequence: 2, required: true, status: "NOT_REACHED", source: APPROVAL_ROUTING_MODE.MANAGER_CHAIN }
      ] };
      assert.equal((await finalizeChainApproval(request, activeApprovalStep(request), { _id: mid })).complete, true);
      assert.deepEqual(request.approvalRouteSnapshot.map((step) => step.status), ["APPROVED", "SKIPPED"]);
    });

    await t.test("all tracks finalize without a legacy Approver policy tail", async () => {
      const jefe = await makeUser({ name: "All tracks jefe" });
      const requester = await makeUser({ name: "All tracks requester", jefe: jefe._id });
      for (const flowType of ["A1", "A2", "B", "C"]) {
        const request = { requester: requester._id, flowType };
        await initializeApprovalRoute(request);
        assert.equal(request.approvalRouteSnapshot.length, 1);
        request.approvalRouteSnapshot.push({ source: "RULE_BASED", role: "Approver", approvalLevel: "VICE_RECTOR", sequence: 2, status: "NOT_REACHED", required: true });
        const result = await finalizeChainApproval(request, activeApprovalStep(request), jefe);
        assert.equal(result.complete, true);
        assert.equal(request.approvalRouteSnapshot[1].status, "SKIPPED");
        assert.equal(request.approvalDueAt, null);
      }
    });

    await t.test("the root of the chain cannot forward further", async () => {
      const root = await makeUser({ dni: "90000020", name: "Solo Root" });
      const requester = await makeUser({ dni: "90000021", name: "Reports To Root", jefe: root._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      assert.equal(request.approvalRouteSnapshot.length, 1);
      const step = activeApprovalStep(request);
      await assert.rejects(
        activateNextChainStep(request, step, root),
        (error) => error.statusCode === 422
      );
    });

    await t.test("routing skips an inactive or on-leave jefe and forwards past them too", async () => {
      const top = await makeUser({ dni: "90000040", name: "Available Top" });
      const onLeave = await makeUser({ dni: "90000041", name: "On Leave Middle", jefe: top._id, onLeave: true });
      const inactive = await makeUser({ dni: "90000042", name: "Inactive Lead", jefe: onLeave._id, active: false });
      const requester = await makeUser({ dni: "90000043", name: "Routed Requester", jefe: inactive._id });
      const request = { requester: requester._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(request);
      assert.equal(String(activeApprovalStep(request).approverUser), String(top._id));

      const lead = await makeUser({ dni: "90000044", name: "Available Lead", jefe: onLeave._id });
      const second = await makeUser({ dni: "90000045", name: "Second Requester", jefe: lead._id });
      const forwarded = { requester: second._id, approvalRouteSnapshot: [] };
      await initializeApprovalRoute(forwarded);
      assert.equal(String((await activateNextChainStep(forwarded, activeApprovalStep(forwarded), lead)).next.approverUser), String(top._id));
    });

    await t.test("no available jefe at all returns a clear contact-Admin error", async () => {
      const gone = await makeUser({ dni: "90000050", name: "Gone Manager", active: false });
      const requester = await makeUser({ dni: "90000051", name: "Stranded Requester", jefe: gone._id });
      await assert.rejects(initializeApprovalRoute({ requester: requester._id, approvalRouteSnapshot: [] }), (error) => error.statusCode === 422 && /Contact the Admin/.test(error.message));
    });

    await t.test("working-day SLA: one working day, skipping weekends and Peruvian holidays", () => {
      // Friday 2026-07-24 10:00 Lima -> Monday 27 (28/29 July are Fiestas Patrias).
      assert.equal(dueDate(24, new Date("2026-07-24T15:00:00Z")).toISOString(), "2026-07-27T15:00:00.000Z");
      // Monday 27 July -> Thursday 30 July, skipping the two national holidays.
      assert.equal(dueDate(24, new Date("2026-07-27T15:00:00Z")).toISOString(), "2026-07-30T15:00:00.000Z");
      // A sub-day express SLA that would end on Saturday moves to the next working day.
      assert.equal(dueDate(4, new Date("2026-09-19T03:00:00Z")).toISOString(), "2026-09-21T07:00:00.000Z");
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
