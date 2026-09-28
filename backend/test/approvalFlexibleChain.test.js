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
import { activeApprovalStep, initializeApprovalRoute } from "../src/services/approvalRuleService.js";
import { decideApproval, getApprovalDecisionOptions, listApprovalInbox } from "../src/services/approvalService.js";
import { countUnreadNotifications, markNotificationRead, notifyUser } from "../src/services/notificationService.js";
import { listRequestsPage, submitFinancialRequest, withdrawFinancialRequest } from "../src/services/requestService.js";
import { deleteUser, listMyTeam, updateMyLeave, updateUser } from "../src/controllers/userController.js";
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

test("flexible manager-chain approval, absence reassignment, withdrawal and My Team scoping", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_flexible_chain_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Notification.init(), AuditLog.init()]);
    const center = await CostCenter.create({ code: "CC-FLEX", name: "Flexible", area: "Operations", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-FLEX", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999981", normalizedIdentifier: "20999999981", legalName: "Flex Supplier SAC", name: "Flex Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9781", paymentTerms: { option: "CREDIT_30", days: 30 } });
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });
    const admin = await User.create({ name: "Admin", email: "flex.admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Operations" });
    const root = await User.create({ name: "Root Manager", email: "flex.root@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations" });
    const mid = await User.create({ name: "Middle Manager", email: "flex.mid@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", jefe: root._id });
    const requester = await User.create({ name: "Requester", email: "flex.requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Operations", costCenter: center._id, jefe: mid._id });
    let sequence = 0;

    async function makeRequest({ submit = true, attachments = true, status = REQUEST_STATUS.PENDING_APPROVAL } = {}) {
      sequence += 1;
      const request = new FinancialRequest({
        requestNumber: `REQ-2026-95${String(sequence).padStart(3, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
        solicitor: requester._id, requester: requester._id, requesterArea: "Operations", requesterCostCenter: center._id, supplier: supplier._id,
        description: "Flexible chain test", status,
        attachments: attachments ? [{ kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf", url: "/test/contract.pdf", mimetype: "application/pdf", size: 10, uploadedBy: requester._id }] : [],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      if (submit) await initializeApprovalRoute(request);
      await request.save();
      return request;
    }

    await t.test("the first jefe can finalize: the chain completes and the budget commits automatically", async () => {
      const request = await makeRequest();
      assert.equal(String(activeApprovalStep(request).approverUser), String(mid._id));
      const options = await getApprovalDecisionOptions(request._id, mid);
      assert.equal(options.canForward, true);
      assert.equal(String(options.forwardTo._id), String(root._id));
      const result = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "Final at level 1", user: mid, req });
      assert.equal(result.request.status, REQUEST_STATUS.BUDGET_COMMITTED, `manager-chain approvals auto-commit like every other route ${JSON.stringify(result.budgetWarning)}`);
      assert.equal(result.request.approvalRouteSnapshot.length, 1, "root was never asked");
      const approved = await Notification.findOne({ user: requester._id, type: "REQUEST_APPROVED", entityId: request._id });
      assert.ok(approved, "the requester is told the request is fully approved");
    });

    await t.test("a chain approval without budget keeps the existing budget-gate outcome", async () => {
      const tight = await CostCenter.create({ code: "CC-TIGHT", name: "Tight", area: "Operations", budgetMode: "ACTIVE", annualBudget: 10, active: true });
      await User.updateOne({ _id: requester._id }, { $set: { authorizedCostCenters: [tight._id] } });
      const request = await makeRequest();
      request.lines[0].costCenter = tight._id;
      await request.save();
      const result = await decideApproval({ id: request._id, action: "APPROVE", forward: false, user: mid, req });
      assert.ok(result.budgetWarning?.code === "INSUFFICIENT_BUDGET", JSON.stringify(result.budgetWarning));
      assert.ok([REQUEST_STATUS.REJECTED, REQUEST_STATUS.OBSERVED_BUDGET].includes(result.request.status));
      assert.equal(await Notification.countDocuments({ user: requester._id, type: "REQUEST_APPROVED", entityId: request._id }), result.budgetWarning.hardReject ? 0 : 1);
    });

    await t.test("send to my jefe, then the top jefe finalizes", async () => {
      const request = await makeRequest();
      const forwarded = await decideApproval({ id: request._id, action: "APPROVE", forward: true, comments: "Up to root", user: mid, req });
      assert.equal(forwarded.request.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.ok(forwarded.request.approvalHistory.some((event) => event.action === "CHAIN_APPROVED_FORWARDED"));
      assert.equal(await Notification.countDocuments({ user: root._id, type: "APPROVAL_PENDING", resolvedAt: null }), 1);
      const inbox = await listApprovalInbox({}, root);
      const row = inbox.data.find((item) => String(item._id) === String(request._id));
      assert.equal(row.approvalOptions.canForward, false, "root has no jefe, so only finalize is offered");
      await assert.rejects(decideApproval({ id: request._id, action: "APPROVE", forward: true, comments: "nowhere", user: root, req }), (error) => error.statusCode === 422);
      const final = await decideApproval({ id: request._id, action: "APPROVE", forward: false, comments: "Final", user: root, req });
      assert.equal(final.request.status, REQUEST_STATUS.BUDGET_COMMITTED);
    });

    await t.test("approvers can always observe, return or reject even when submission checks fail", async () => {
      const request = await makeRequest({ attachments: false });
      await assert.rejects(decideApproval({ id: request._id, action: "APPROVE", forward: false, user: mid, req }), (error) => error.code === "MISSING_REQUIRED_DOCUMENT");
      const observed = await decideApproval({ id: request._id, action: "OBSERVE", comments: "Attach the contract", user: mid, req });
      assert.equal(observed.request.status, REQUEST_STATUS.OBSERVED);
      const other = await makeRequest({ attachments: false });
      const rejected = await decideApproval({ id: other._id, action: "REJECT", comments: "Not justified", user: mid, req });
      assert.equal(rejected.request.status, REQUEST_STATUS.REJECTED);
    });

    await t.test("the requester withdraws before the first approval; the approver's task is resolved", async () => {
      const request = await makeRequest();
      await notifyUserForStep(request);
      await assert.rejects(withdrawFinancialRequest({ id: request._id, user: mid, req }), (error) => error.statusCode === 409);
      const withdrawn = await withdrawFinancialRequest({ id: request._id, user: requester, req, comments: "Need to fix the amount" });
      assert.equal(withdrawn.status, REQUEST_STATUS.DRAFT);
      assert.ok(withdrawn.approvalRouteSnapshot.every((step) => step.status === "SKIPPED"));
      assert.equal(await Notification.countDocuments({ user: mid._id, entityId: request._id, resolvedAt: null }), 0);
      assert.ok(await AuditLog.exists({ action: "REQUEST_WITHDRAWN", entityId: request._id }));

      const approvedOnce = await makeRequest();
      await decideApproval({ id: approvedOnce._id, action: "APPROVE", forward: true, user: mid, req });
      await assert.rejects(withdrawFinancialRequest({ id: approvedOnce._id, user: requester, req }), (error) => error.statusCode === 409, "not after the first approver approved");
    });

    await t.test("resubmission re-resolves the route from the first approver and keeps the old route in the audit log", async () => {
      const request = await makeRequest();
      await decideApproval({ id: request._id, action: "APPROVE", forward: true, user: mid, req });
      await decideApproval({ id: request._id, action: "RETURN", comments: "Fix it", user: root, req });
      // The roster changes meanwhile: the requester now reports straight to root.
      await User.updateOne({ _id: requester._id }, { $set: { jefe: root._id } });
      const resubmitted = await submitFinancialRequest({ id: request._id, user: await User.findById(requester._id), req });
      await User.updateOne({ _id: requester._id }, { $set: { jefe: mid._id } });
      assert.equal(resubmitted.status, REQUEST_STATUS.PENDING_APPROVAL);
      assert.equal(resubmitted.approvalRouteSnapshot.length, 1);
      assert.equal(String(activeApprovalStep(resubmitted).approverUser), String(root._id));
      const reset = await AuditLog.findOne({ action: "APPROVAL_ROUTE_RESET", entityId: request._id });
      assert.ok(reset, "the replaced route is audited");
      assert.deepEqual(reset.oldValues.approvalRoute.map((step) => step.status), ["APPROVED", "RETURNED"]);
    });

    await t.test("re-sent notifications arrive unread", async () => {
      const first = await notifyUser({ userId: mid._id, eventKey: "flex:resend", type: "APPROVAL_PENDING", title: "Approval pending", message: "First" });
      await markNotificationRead(first._id, mid._id);
      const before = await countUnreadNotifications(mid._id);
      await notifyUser({ userId: mid._id, eventKey: "flex:resend", type: "APPROVAL_PENDING", title: "Approval pending", message: "Again" });
      assert.equal(await countUnreadNotifications(mid._id), before + 1);
      assert.equal((await Notification.findById(first._id)).message, "Again");
    });

    await t.test("putting an approver on leave moves their pending steps to their nearest available jefe", async () => {
      const request = await makeRequest();
      const body = await callController(updateUser, { params: { id: String(mid._id) }, body: { onLeave: true }, user: admin });
      assert.equal(body.approvalReassignment.reassigned >= 1, true);
      const reloaded = await FinancialRequest.findById(request._id);
      assert.equal(String(activeApprovalStep(reloaded).approverUser), String(root._id));
      assert.ok(reloaded.approvalHistory.some((event) => event.action === "APPROVAL_REASSIGNED"));
      const audit = await AuditLog.findOne({ action: "APPROVAL_REASSIGNED", entityId: request._id });
      assert.equal(String(audit.oldValues.approverUser), String(mid._id));
      assert.equal(String(audit.newValues.approverUser), String(root._id));
      assert.equal(await Notification.countDocuments({ user: root._id, entityId: request._id, type: "APPROVAL_PENDING", resolvedAt: null }), 1);
      assert.equal(await Notification.countDocuments({ user: mid._id, entityId: request._id, type: "APPROVAL_PENDING", resolvedAt: null }), 0);
      // New submissions route past the on-leave jefe instead of failing.
      const routed = await makeRequest();
      assert.equal(String(activeApprovalStep(routed).approverUser), String(root._id));
      await callController(updateUser, { params: { id: String(mid._id) }, body: { onLeave: false }, user: admin });
      assert.equal((await User.findById(mid._id)).leaveStartedAt, undefined);
    });

    await t.test("a user can record their own leave; deactivation also reassigns", async () => {
      const request = await makeRequest();
      await callController(updateMyLeave, { body: { onLeave: true }, user: mid });
      assert.equal(String(activeApprovalStep(await FinancialRequest.findById(request._id)).approverUser), String(root._id));
      await callController(updateMyLeave, { body: { onLeave: false }, user: mid });

      const second = await makeRequest();
      await callController(deleteUser, { params: { id: String(mid._id) }, user: admin });
      assert.equal(String(activeApprovalStep(await FinancialRequest.findById(second._id)).approverUser), String(root._id));
      await User.updateOne({ _id: mid._id }, { $set: { active: true } });
    });

    await t.test("with no one available above, submission fails with a contact-Admin error", async () => {
      await User.updateMany({ _id: { $in: [mid._id, root._id] } }, { $set: { onLeave: true } });
      await assert.rejects(makeRequest(), (error) => error.statusCode === 422 && /Contact the Admin/.test(error.message));
      await User.updateMany({ _id: { $in: [mid._id, root._id] } }, { $set: { onLeave: false } });
    });

    await t.test("My Team hides drafts, links only viewable rows and scopes Admin to its own team", async () => {
      const draft = await makeRequest({ submit: false, status: REQUEST_STATUS.DRAFT });
      const routedToRoot = await makeRequest();
      await User.updateOne({ _id: mid._id }, { $set: { onLeave: true } });
      const reroute = await FinancialRequest.findById(routedToRoot._id);
      await initializeApprovalRoute(reroute); await reroute.save();
      await User.updateOne({ _id: mid._id }, { $set: { onLeave: false } });

      const page = await listRequestsPage({ teamScope: "true", pageSize: 100 }, mid);
      const ids = page.data.map((row) => String(row._id));
      assert.ok(!ids.includes(String(draft._id)), "team drafts never appear");
      const row = page.data.find((item) => String(item._id) === String(routedToRoot._id));
      assert.equal(row.canView, false, "mid is not on this request's route");
      assert.ok(page.data.some((item) => item.canView === true));
      const drafts = await listRequestsPage({ teamScope: "true", status: "BORRADOR" }, mid);
      assert.equal(drafts.data.length, 0);
      const adminTeam = await listRequestsPage({ teamScope: "true" }, admin);
      assert.equal(adminTeam.data.length, 0, "Admin with teamScope sees only its own (empty) team");
      const roster = await callController(listMyTeam, { user: mid });
      const counts = roster.data.find((member) => String(member._id) === String(requester._id)).requestCounts;
      assert.equal(counts.total, await FinancialRequest.countDocuments({ requester: requester._id, status: { $ne: REQUEST_STATUS.DRAFT } }));
    });

    async function notifyUserForStep(request) {
      const { notifyApprovalStep } = await import("../src/services/notificationService.js");
      await notifyApprovalStep(request);
      assert.equal(await Notification.countDocuments({ user: mid._id, entityId: request._id, resolvedAt: null }), 1);
    }
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
