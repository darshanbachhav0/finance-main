import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import AuditLog from "../src/models/AuditLog.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import User from "../src/models/User.js";
import { countPendingTreasuryBudgets, listPendingTreasuryBudgets } from "../src/services/treasuryBudgetQueueService.js";

test("Treasury finds approved requests whose budget handoff produced no payable", async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_treasury_budget_${process.pid}_${Date.now()}`, { serverSelectionTimeoutMS: 5000 });
  let server;
  try {
    const [treasury, requester, accounting] = await User.create(["Treasury", "Solicitor", "Accounting"].map(role => ({ name: role, role, passwordHash: "unused" })));
    const supplier = await Supplier.create({ rucDni: "20523401956", name: "Supplier for pending handoff", legalName: "Supplier for pending handoff" });
    const make = (suffix, extra = {}) => ({ _id: new mongoose.Types.ObjectId(), requestNumber: `SOL-2026-${suffix}`, flowType: "B", status: "APROBADO",
      requester: requester._id, solicitor: requester._id, supplier: supplier._id, currency: "PEN", totalAmount: 5000, totalPENEquivalent: 5000,
      approvalStage: "COMPLETE", approvalRouteSnapshot: [{ required: true, status: "APPROVED" }], updatedAt: new Date(), ...extra });
    const target = make("00144");
    const alreadyPayable = make("00145");
    const cancelledOnly = make("00146");
    await FinancialRequest.collection.insertMany([target, alreadyPayable, cancelledOnly,
      make("TRANSFER", { flowType: "D" }), make("DRAFT", { status: "BORRADOR" }),
      make("PENDING", { status: "PENDIENTE_APROBACION" }), make("COMMITTED", { status: "COMPROMISO_PRESUPUESTAL" }),
      make("CLOSED", { status: "CERRADO" }), make("MORE-APPROVALS", { approvalRouteSnapshot: [{ required: true, status: "PENDING" }] })
    ]);
    await AccountsPayable.collection.insertMany([{ request: alreadyPayable._id, status: "OPEN" }, { request: cancelledOnly._id, status: "CANCELLED" }]);
    await AuditLog.collection.insertMany([
      { entityType: "FinancialRequest", entityId: target._id, action: "BUDGET_COMMITMENT_PENDING", message: "Supplier approval was pending.", createdAt: new Date(0) },
      { entityType: "FinancialRequest", entityId: target._id, action: "BUDGET_COMMITMENT_DEFERRED", message: "Review the approved request and retry budget commitment.", createdAt: new Date() }
    ]);
    assert.equal(await countPendingTreasuryBudgets(), 2);
    const linked = await listPendingTreasuryBudgets({ request: String(target._id) });
    assert.equal(linked.pagination.total, 1);
    assert.equal(linked.data[0].requestNumber, "SOL-2026-00144");
    assert.equal(linked.data[0].supplier.legalName, supplier.legalName);
    assert.equal(linked.data[0].requester.name, "Solicitor");
    assert.equal(linked.data[0].pendingReason, "Review the approved request and retry budget commitment.");
    assert.equal((await listPendingTreasuryBudgets({ search: "00144", pageSize: 1 })).pagination.total, 1);
    await assert.rejects(listPendingTreasuryBudgets({ request: "invalid" }), error => error.statusCode === 422);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.on("listening", resolve));
    const call = async (user, path) => {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call(treasury, `/treasury/pending-budgets?request=${target._id}`)).body.pagination.total, 1);
    for (const user of [requester, accounting]) assert.equal((await call(user, "/treasury/pending-budgets")).status, 403);
    const tasks = (await call(treasury, "/dashboard/tasks")).body;
    const task = tasks.items.find(item => item.key === "budgetCommitments");
    assert.equal(task.count, 2);
    assert.equal(task.path, "/treasury?tab=budget");
    await FinancialRequest.updateOne({ _id: target._id }, { $set: { status: "COMPROMISO_PRESUPUESTAL" } });
    assert.equal((await listPendingTreasuryBudgets({ request: String(target._id) })).pagination.total, 0, "completed commitments leave the queue");
    assert.equal(await AccountsPayable.countDocuments({ request: target._id }), 0, "reading Treasury queues must never create a payable");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
