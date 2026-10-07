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
import { decideApproval, getApprovalDecisionOptions } from "../src/services/approvalService.js";
import { getMyLeave, updateMyLeave, updateUser } from "../src/controllers/userController.js";
import { me } from "../src/controllers/authController.js";
import { endExpiredLeaves } from "../src/services/userLeaveService.js";
import { EXPENSE_NATURE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };

async function callController(handler, request) {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  let error;
  await handler({ headers: {}, ip: "127.0.0.1", ...request }, res, (value) => { error = value; });
  if (error) throw error;
  return res.body;
}

// The top of the roster (the Gerente General) has no jefe: without a substitute, her absence
// strands every approval that reaches her.
test("a substitute covers an absent manager's approvals and hands them back on return", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_leave_substitute_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Notification.init(), AuditLog.init()]);
    const center = await CostCenter.create({ code: "CC-SUB", name: "Substitute", area: "Gerencia", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-SUB", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999971", normalizedIdentifier: "20999999971", legalName: "Substitute Supplier SAC", name: "Substitute Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9771", paymentTerms: { option: "CREDIT_30", days: 30 } });
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });
    const admin = await User.create({ name: "Admin", email: "sub.admin@test.local", passwordHash: "unused", role: ROLES.ADMIN, area: "Systems" });
    const gerente = await User.create({ name: "Gerente General", jobTitle: "GERENTE GENERAL", email: "sub.gerente@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia" });
    const deputy = await User.create({ name: "Encargado", jobTitle: "GERENTE DE ADMINISTRACION FINANCIERA", email: "sub.deputy@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: gerente._id, costCenter: center._id });
    const other = await User.create({ name: "Otro Gerente", email: "sub.other@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: gerente._id });
    const director = await User.create({ name: "Director", email: "sub.director@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: gerente._id });
    const directReport = await User.create({ name: "Reporte Directo", email: "sub.direct@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: gerente._id, costCenter: center._id });
    const staff = await User.create({ name: "Analista", email: "sub.staff@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: director._id, costCenter: center._id });
    const inactive = await User.create({ name: "Inactivo", email: "sub.inactive@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", active: false });
    let sequence = 0;

    async function submit(requester) {
      sequence += 1;
      const request = new FinancialRequest({
        requestNumber: `REQ-2026-97${String(sequence).padStart(3, "0")}`, requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
        issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
        solicitor: requester._id, requester: requester._id, requesterArea: "Gerencia", requesterCostCenter: center._id, supplier: supplier._id,
        description: "Substitute test", status: REQUEST_STATUS.PENDING_APPROVAL,
        attachments: [{ kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf", url: "/test/contract.pdf", mimetype: "application/pdf", size: 10, uploadedBy: requester._id }],
        lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
      });
      await initializeApprovalRoute(request);
      await request.save();
      return request;
    }
    const setUser = (target, body, actor = admin) => callController(updateUser, { params: { id: String(target._id) }, body, user: actor });
    const stepOf = async (request) => activeApprovalStep(await FinancialRequest.findById(request._id));

    await t.test("Admin chooses an active, internal substitute other than the person", async () => {
      await assert.rejects(() => setUser(gerente, { substitute: String(gerente._id) }), /own substitute/);
      await assert.rejects(() => setUser(gerente, { substitute: String(inactive._id) }), /active, internal substitute/);
      await setUser(gerente, { substitute: String(deputy._id) });
      assert.equal(String((await User.findById(gerente._id)).substitute), String(deputy._id));
    });

    let waiting;
    await t.test("going on leave moves her pending approvals to the substitute, on her behalf", async () => {
      waiting = await submit(directReport);
      assert.equal(String((await stepOf(waiting)).approverUser), String(gerente._id));
      const result = await setUser(gerente, { onLeave: true });
      assert.equal(result.approvalReassignment.reassigned, 1);
      const step = await stepOf(waiting);
      assert.equal(String(step.approverUser), String(deputy._id));
      assert.equal(String(step.coveringFor), String(gerente._id));
      assert.equal(step.coveringForSnapshot.name, "Gerente General");
      assert.ok(await Notification.findOne({ user: deputy._id, entityId: waiting._id }), "the substitute is told");
      const audit = await AuditLog.findOne({ entityId: waiting._id, action: "APPROVAL_REASSIGNED" });
      assert.match(audit.comments, /to Encargado on behalf of Gerente General \(on leave\)/);
    });

    await t.test("new requests from her direct reports go to the substitute instead of failing", async () => {
      const request = await submit(other);
      const step = await stepOf(request);
      assert.equal(String(step.approverUser), String(deputy._id));
      assert.equal(String(step.coveringFor), String(gerente._id));
    });

    await t.test("a manager below her can still send a request up: it reaches the substitute", async () => {
      const request = await submit(staff);
      assert.equal(String((await stepOf(request)).approverUser), String(director._id));
      const options = await getApprovalDecisionOptions(request._id, director);
      assert.equal(options.canForward, true);
      assert.equal(String(options.forwardTo._id), String(deputy._id));
      await decideApproval({ id: request._id, action: "APPROVE", forward: true, comments: "Up to Gerencia", user: director, req });
      const step = await stepOf(request);
      assert.equal(String(step.approverUser), String(deputy._id));
      assert.equal(String(step.coveringFor), String(gerente._id));
    });

    await t.test("the substitute decides in her place; nobody is above her, so the decision is final", async () => {
      const options = await getApprovalDecisionOptions(waiting._id, deputy);
      assert.equal(options.canForward, false);
      const result = await decideApproval({ id: waiting._id, action: "APPROVE", forward: false, comments: "Approved on behalf of Gerencia", user: deputy, req });
      assert.equal(result.request.approvalStage, "COMPLETE");
      const decided = result.request.approvalRouteSnapshot.find((step) => String(step.coveringFor?._id || step.coveringFor) === String(gerente._id));
      assert.equal(String(decided.completedBy?._id || decided.completedBy), String(deputy._id));
    });

    await t.test("the substitute's own requests cannot be approved by themselves", async () => {
      await assert.rejects(() => submit(deputy), /No supervisor is available/);
    });

    await t.test("a new substitute takes over what the previous one holds while she is still away", async () => {
      await setUser(gerente, { substitute: String(director._id) });
      const covered = await FinancialRequest.find({ "approvalRouteSnapshot.coveringFor": gerente._id, status: REQUEST_STATUS.PENDING_APPROVAL });
      const pending = covered.map(activeApprovalStep).filter((step) => step && String(step.coveringFor) === String(gerente._id));
      assert.ok(pending.length >= 1);
      // The director's own forwarded request would make them approve twice: it stays with the deputy.
      for (const step of pending) assert.ok([String(director._id), String(deputy._id)].includes(String(step.approverUser)));
      assert.ok(pending.some((step) => String(step.approverUser) === String(director._id)));
      await setUser(gerente, { substitute: String(deputy._id) });
    });

    await t.test("when she is back, the approvals held for her return to her", async () => {
      const result = await callController(updateMyLeave, { body: { onLeave: false }, user: await User.findById(gerente._id) });
      assert.ok(result.approvalReassignment.reassigned >= 2);
      const stillCovered = (await FinancialRequest.find({ status: REQUEST_STATUS.PENDING_APPROVAL })).map(activeApprovalStep).filter((step) => step?.coveringFor);
      assert.equal(stillCovered.length, 0);
      const back = (await FinancialRequest.find({ status: REQUEST_STATUS.PENDING_APPROVAL })).map(activeApprovalStep).filter((step) => String(step?.approverUser) === String(gerente._id));
      assert.ok(back.length >= 2);
      assert.ok(await AuditLog.findOne({ action: "APPROVAL_REASSIGNED", comments: /back from leave/ }));
    });

    await t.test("without a substitute the top of the roster behaves as before", async () => {
      await setUser(gerente, { substitute: "" });
      assert.equal((await User.findById(gerente._id)).substitute, null);
      await setUser(gerente, { onLeave: true });
      await assert.rejects(() => submit(other), /No supervisor is available/);
      const stranded = await Notification.countDocuments({ type: "APPROVAL_UNASSIGNED" });
      assert.ok(stranded >= 1, "Admin is told the approvals waiting on her have nobody to go to");
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("self-service leave: who covers, a last day that ends the leave by itself, and clear notifications", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_leave_self_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await Promise.all([Notification.init(), AuditLog.init()]);
    await AccountingPeriod.create({ period: "2026-09", status: "OPEN" });
    const center = await CostCenter.create({ code: "CC-SELF", name: "Self", area: "Gerencia", budgetMode: "ACTIVE", annualBudget: 1000000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-SELF", name: "Services", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", active: true });
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20999999961", normalizedIdentifier: "20999999961", legalName: "Self Supplier SAC", name: "Self Supplier SAC", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true, supplierCode: "PRV-9761", paymentTerms: { option: "CREDIT_30", days: 30 } });
    const top = await User.create({ name: "Gerente", email: "self.top@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia" });
    const deputy = await User.create({ name: "Encargada", jobTitle: "GERENTE ADMINISTRATIVA", email: "self.deputy@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: top._id });
    const manager = await User.create({ name: "Jefa de Area", email: "self.manager@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: top._id });
    const requester = await User.create({ name: "Analista", email: "self.requester@test.local", passwordHash: "unused", role: ROLES.SOLICITOR, area: "Gerencia", jefe: top._id, costCenter: center._id });
    await User.updateOne({ _id: top._id }, { $set: { substitute: deputy._id } });
    const request = new FinancialRequest({
      requestNumber: "REQ-2026-98001", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES,
      issueDate: "2026-09-10", accountingPeriod: "2026-09", currency: "PEN", flowType: "A1",
      solicitor: requester._id, requester: requester._id, requesterArea: "Gerencia", requesterCostCenter: center._id, supplier: supplier._id,
      description: "Self-service leave test", status: REQUEST_STATUS.PENDING_APPROVAL,
      attachments: [{ kind: "CONTRACT", originalName: "contract.pdf", filename: "contract.pdf", url: "/test/contract.pdf", mimetype: "application/pdf", size: 10, uploadedBy: requester._id }],
      lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 100, igvAmount: 18, totalAmount: 118 }]
    });
    await initializeApprovalRoute(request);
    await request.save();
    const myLeave = async (user) => (await callController(getMyLeave, { user })).data;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    await t.test("before leaving, a person sees who will cover them and what is waiting", async () => {
      const summary = await myLeave(top);
      assert.equal(summary.onLeave, false);
      assert.deepEqual([summary.coverage.via, summary.coverage.person.name], ["SUBSTITUTE", "Encargada"]);
      assert.equal(summary.pendingApprovals, 1);
      const managerView = await myLeave(manager);
      assert.deepEqual([managerView.coverage.via, managerView.coverage.person.name], ["SUPERVISOR", "Gerente"], "without a substitute, the jefe covers");
      await User.updateOne({ _id: top._id }, { $set: { substitute: null } });
      assert.equal((await myLeave(top)).coverage.via, null, "nobody can cover the top of the roster without a substitute");
      await User.updateOne({ _id: top._id }, { $set: { substitute: deputy._id } });
    });

    await t.test("a last day in the past is refused", async () => {
      const self = await User.findById(top._id);
      await assert.rejects(() => callController(updateMyLeave, { body: { onLeave: true, leaveUntil: "2020-01-01" }, user: self }), /cannot be in the past/);
    });

    await t.test("starting leave tells the substitute and hands them the approvals, on her behalf", async () => {
      const result = await callController(updateMyLeave, { body: { onLeave: true, leaveUntil: tomorrow }, user: await User.findById(top._id) });
      assert.equal(result.leave.onLeave, true);
      assert.equal(result.leave.leaveUntil, tomorrow);
      const started = await Notification.findOne({ user: deputy._id, type: "LEAVE_COVERAGE_STARTED" });
      assert.match(started.message, /Gerente is on leave until/);
      const pending = await Notification.findOne({ user: deputy._id, type: "APPROVAL_PENDING", entityId: request._id });
      assert.match(pending.message, /waiting for your approval on behalf of Gerente/);
      const deputyView = await myLeave(deputy);
      assert.deepEqual(deputyView.covering.map((item) => [item.name, item.count]), [["Gerente", 1]]);
    });

    await t.test("once the last day has passed, opening the app ends the leave and brings the approvals back", async () => {
      await User.updateOne({ _id: top._id }, { $set: { leaveUntil: new Date(Date.now() - 2 * 86400000) } });
      const session = await callController(me, { user: await User.findById(top._id) });
      assert.equal(session.user.onLeave, false);
      const step = activeApprovalStep(await FinancialRequest.findById(request._id));
      assert.equal(String(step.approverUser), String(top._id));
      assert.equal(step.coveringFor, undefined);
      assert.ok(await Notification.findOne({ user: top._id, type: "LEAVE_ENDED" }), "she is welcomed back");
      assert.ok(await Notification.findOne({ user: deputy._id, type: "LEAVE_COVERAGE_ENDED" }), "the substitute is told coverage ended");
      assert.ok(await AuditLog.findOne({ entityId: top._id, action: "LEAVE_ENDED", comments: /automatically/ }));
    });

    await t.test("the scheduled scan ends leaves past their last day, and keeps those that are not", async () => {
      await User.updateOne({ _id: top._id }, { $set: { onLeave: true, leaveUntil: new Date(`${tomorrow}T00:00:00Z`) } });
      await User.updateOne({ _id: manager._id }, { $set: { onLeave: true, leaveUntil: new Date(Date.now() - 3 * 86400000) } });
      assert.deepEqual(await endExpiredLeaves(), { ended: 1 });
      assert.equal((await User.findById(manager._id)).onLeave, false);
      assert.equal((await User.findById(top._id)).onLeave, true, "a leave ending tomorrow continues");
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
