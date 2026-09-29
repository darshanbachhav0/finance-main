import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AuditLog from "../src/models/AuditLog.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import approvalRoutes from "../src/routes/approvalRoutes.js";
import notificationRoutes from "../src/routes/notificationRoutes.js";
import { bulkApproveRequestsHandler } from "../src/controllers/approvalController.js";
import { dismissOneNotification } from "../src/controllers/notificationController.js";
import { activeApprovalStep, initializeApprovalRoute } from "../src/services/approvalRuleService.js";
import { MAX_BULK_APPROVALS, bulkApproveRequests } from "../src/services/approvalService.js";
import { countUnreadNotifications, dismissNotification, listUserNotifications, notifyUser } from "../src/services/notificationService.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function callController(handler, request) {
  const res = mockRes();
  let error;
  await handler({ headers: {}, ip: "127.0.0.1", ...request }, res, (value) => { error = value; });
  if (error) throw error;
  return res.body;
}

const routePaths = (router) => router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

test("bulk approval runs decideApproval per request with one shared decision", { timeout: 180000 }, async (t) => {
  const databaseName = `erp_bulk_approval_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Notification.init(), AuditLog.init()]);
    const center = await CostCenter.create({ code: "CC-BULK", name: "Bulk", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-BULK", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999971", normalizedIdentifier: "20999999971", legalName: "Bulk Supplier SAC", name: "Bulk Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9771", paymentTerms: { option: "CREDIT_30", days: 30 } });
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });
    const root = await User.create({ name: "Root Manager", email: "bulk.root@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    const mid = await User.create({ name: "Middle Manager", email: "bulk.mid@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", jefe: root._id });
    const other = await User.create({ name: "Other Manager", email: "bulk.other@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    const requester = await User.create({ name: "Requester", email: "bulk.requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, jefe: mid._id });
    const directReport = await User.create({ name: "Direct report", email: "bulk.direct@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, jefe: root._id });
    const otherReport = await User.create({ name: "Other report", email: "bulk.otherreport@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, jefe: other._id });
    let sequence = 0;

    async function makeRequest({ owner = requester, attachments = true } = {}) {
      sequence += 1;
      const request = new FinancialRequest({
        requestNumber: `REQ-2026-97${String(sequence).padStart(3, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
        solicitor: owner._id, requester: owner._id, requesterArea: "Operations", requesterCostCenter: center._id, supplier: supplier._id,
        description: "Bulk approval test", status: REQUEST_STATUS.PENDING_APPROVAL,
        attachments: attachments ? [{ kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf", url: "/test/contract.pdf", mimetype: "application/pdf", size: 10, uploadedBy: owner._id }] : [],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      await initializeApprovalRoute(request);
      await request.save();
      return request;
    }

    await t.test("the route is registered before the /:id routes", () => {
      const paths = routePaths(approvalRoutes);
      assert.ok(paths.includes("POST /bulk"));
      assert.ok(paths.indexOf("POST /bulk") < paths.indexOf("POST /:id/approve"));
      assert.ok(routePaths(notificationRoutes).includes("PATCH /:id/dismiss"));
    });

    await t.test("input is validated and the batch is capped", async () => {
      await assert.rejects(bulkApproveRequests({ ids: [], forward: false, user: mid, req }), (error) => error.statusCode === 422);
      await assert.rejects(bulkApproveRequests({ ids: "abc", forward: false, user: mid, req }), (error) => error.statusCode === 422);
      await assert.rejects(bulkApproveRequests({ ids: [new mongoose.Types.ObjectId()], forward: "yes", user: mid, req }), (error) => error.statusCode === 422 && error.details.field === "forward");
      const tooMany = Array.from({ length: MAX_BULK_APPROVALS + 1 }, () => String(new mongoose.Types.ObjectId()));
      await assert.rejects(bulkApproveRequests({ ids: tooMany, forward: false, user: mid, req }), (error) => error.statusCode === 422 && error.details.max === MAX_BULK_APPROVALS);
      assert.equal(MAX_BULK_APPROVALS, 50);
      // Duplicates count once, so 51 copies of the same id is a batch of one.
      const request = await makeRequest();
      const repeated = await bulkApproveRequests({ ids: Array(MAX_BULK_APPROVALS + 1).fill(String(request._id)), forward: false, user: mid, req });
      assert.deepEqual(repeated.summary, { requested: 1, approved: 1, failed: 0 });
    });

    await t.test("a manager-chain batch needs one explicit finalize-or-forward choice", async () => {
      const request = await makeRequest();
      await assert.rejects(bulkApproveRequests({ ids: [request._id], user: mid, req }), (error) => error.statusCode === 422 && error.details.field === "forward" && error.details.requests.length === 1);
      assert.equal((await FinancialRequest.findById(request._id)).status, REQUEST_STATUS.PENDING_APPROVAL, "nothing is decided");
    });

    await t.test("finalize: approved rows complete, and each row fails or succeeds on its own", async () => {
      const first = await makeRequest();
      const second = await makeRequest();
      const missingDocuments = await makeRequest({ attachments: false });
      const notMine = await makeRequest({ owner: otherReport });
      const unknown = String(new mongoose.Types.ObjectId());
      const body = await callController(bulkApproveRequestsHandler, {
        body: { ids: [first._id, second._id, missingDocuments._id, notMine._id, unknown, "not-an-id"], comments: "Monthly batch", forward: false },
        user: mid
      });
      const { results, summary } = body.data;
      assert.deepEqual(summary, { requested: 6, approved: 2, failed: 4 });
      const byId = Object.fromEntries(results.map((item) => [item.id, item]));
      assert.equal(byId[first._id].ok, true);
      assert.equal(byId[first._id].status, REQUEST_STATUS.BUDGET_COMMITTED, "the regular post-approval budget commitment still runs");
      assert.equal(byId[second._id].ok, true);
      assert.equal(byId[missingDocuments._id].ok, false);
      assert.equal(byId[missingDocuments._id].code, "MISSING_REQUIRED_DOCUMENT", "approval controls are not bypassed");
      assert.equal(byId[missingDocuments._id].requestNumber, missingDocuments.requestNumber);
      assert.equal(byId[notMine._id].ok, false);
      assert.equal(byId[notMine._id].statusCode, 403, "a row assigned to another manager is refused");
      assert.equal(byId[unknown].statusCode, 404);
      assert.equal(byId["not-an-id"].statusCode, 404);
      assert.equal((await FinancialRequest.findById(missingDocuments._id)).status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal((await FinancialRequest.findById(notMine._id)).status, REQUEST_STATUS.PENDING_APPROVAL);
      const approved = await FinancialRequest.findById(first._id);
      assert.ok(approved.approvalHistory.some((event) => event.action === "CHAIN_APPROVED_FINAL" && event.comments === "Monthly batch"), "the shared comment is recorded on each approval");
      assert.ok(await AuditLog.exists({ entityId: first._id, action: "CHAIN_APPROVED_FINAL" }));
      assert.ok(await Notification.exists({ user: requester._id, type: "REQUEST_APPROVED", entityId: second._id }));
    });

    await t.test("send to my jefe: every row goes up one level", async () => {
      const first = await makeRequest();
      const second = await makeRequest();
      const { results, summary } = await bulkApproveRequests({ ids: [first._id, second._id], comments: "Up", forward: true, user: mid, req });
      assert.equal(summary.approved, 2);
      assert.ok(results.every((item) => item.ok && item.forwarded && item.status === REQUEST_STATUS.PENDING_APPROVAL));
      for (const id of [first._id, second._id]) {
        const reloaded = await FinancialRequest.findById(id);
        assert.equal(String(activeApprovalStep(reloaded).approverUser), String(root._id));
        assert.ok(reloaded.approvalHistory.some((event) => event.action === "CHAIN_APPROVED_FORWARDED"));
      }
    });

    await t.test("send to my jefe is refused for the whole batch when any row cannot be forwarded", async () => {
      const forwarded = await makeRequest();
      await bulkApproveRequests({ ids: [forwarded._id], forward: true, user: mid, req });
      const direct = await makeRequest({ owner: directReport });
      // root has no jefe: neither request can go further up.
      await assert.rejects(
        bulkApproveRequests({ ids: [forwarded._id, direct._id], comments: "Up", forward: true, user: root, req }),
        (error) => error.statusCode === 422 && error.details.reason === "FORWARD_NOT_AVAILABLE" && error.details.requests.length === 2
      );
      for (const id of [forwarded._id, direct._id]) assert.equal(String(activeApprovalStep(await FinancialRequest.findById(id)).approverUser), String(root._id), "nothing was decided");
      // A row the user cannot approve does not count against the forward check; it just fails.
      const midRow = await makeRequest();
      const mixed = await bulkApproveRequests({ ids: [midRow._id, direct._id], forward: false, user: root, req });
      assert.deepEqual(mixed.summary, { requested: 2, approved: 1, failed: 1 });
      assert.equal(mixed.results.find((item) => item.id === String(midRow._id)).statusCode, 403);
      const final = await bulkApproveRequests({ ids: [forwarded._id], forward: false, user: root, req });
      assert.equal(final.results[0].status, REQUEST_STATUS.BUDGET_COMMITTED);
    });

    await t.test("an approver cannot bulk-approve their own request", async () => {
      const own = await makeRequest({ owner: mid });
      const result = await bulkApproveRequests({ ids: [own._id], forward: false, user: mid, req });
      assert.equal(result.results[0].ok, false);
      assert.equal(result.results[0].statusCode, 403);
    });

    await t.test("a notification can be marked done by its owner only", async () => {
      const item = await notifyUser({ userId: mid._id, eventKey: "bulk:dismiss", type: "REQUEST_APPROVED", title: "Request approved", message: "Done" });
      const before = await countUnreadNotifications(mid._id);
      assert.equal(await dismissNotification(item._id, root._id), null, "another user's notification is untouched");
      await assert.rejects(callController(dismissOneNotification, { params: { id: String(item._id) }, user: root }), (error) => error.statusCode === 404);
      const body = await callController(dismissOneNotification, { params: { id: String(item._id) }, user: mid });
      assert.ok(body.data.readAt && body.data.resolvedAt);
      assert.equal(await countUnreadNotifications(mid._id), before - 1);
      assert.ok(!(await listUserNotifications(mid._id)).some((entry) => String(entry._id) === String(item._id)), "it leaves the bell");
      await notifyUser({ userId: mid._id, eventKey: "bulk:dismiss", type: "REQUEST_APPROVED", title: "Request approved", message: "Again" });
      assert.ok((await listUserNotifications(mid._id)).some((entry) => String(entry._id) === String(item._id) && !entry.readAt), "a re-sent event comes back unread");
    });
  } finally {
    if (mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
