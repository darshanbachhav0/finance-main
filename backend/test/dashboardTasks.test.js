import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import BudgetException from "../src/models/BudgetException.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import User from "../src/models/User.js";

// "My tasks" on every dashboard is built from /dashboard/tasks: each task names its count,
// urgency and where it opens (the exact record when there is one, otherwise a filtered list).
// Management decides reviewed budget exceptions from the Approval Inbox.
test("dashboard tasks: role work, exact-record links and the Management decision queue", { timeout: 60000 }, async (t) => {
  const database = `erp_dashboard_tasks_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const roles = ["Admin", "Solicitor", "Accounting", "Treasury", "Budget", "Management", "AreaDirector"];
    const users = Object.fromEntries((await User.create(roles.map((role) => ({ name: role, email: `${role.toLowerCase()}-tasks@test.local`, passwordHash: "unused", role, area: "Operations", approvalAreas: role === "AreaDirector" ? ["Operations"] : [] })))).map((user) => [user.role, user]));
    const call = async (role, path, method = "GET", body) => {
      const token = jwt.sign({ id: users[role]._id }, process.env.JWT_SECRET || "dev_secret_change_me");
      const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    const tasksOf = async (role) => {
      const response = await call(role, "/dashboard/tasks");
      assert.equal(response.status, 200);
      return { ...response.body, byKey: Object.fromEntries(response.body.items.map((item) => [item.key, item])) };
    };
    const now = Date.now();
    const day = 86400000;
    const owner = { requester: users.Solicitor._id, solicitor: users.Solicitor._id, requesterArea: "Operations", totalAmount: 100, totalPENEquivalent: 100, currency: "PEN" };
    const request = (fields) => ({ _id: new mongoose.Types.ObjectId(), ...owner, ...fields });

    await t.test("a requester sees drafts, corrections and renditions due, each opening the right place", async () => {
      const draft = request({ requestNumber: "T-DRAFT", status: "BORRADOR" });
      const soon = request({ requestNumber: "T-REN-SOON", status: "PAGADO", flowType: "C", rendition: { status: "PENDING", dueAt: new Date(now + 2 * day) } });
      const late = request({ requestNumber: "T-REN-LATE", status: "PAGADO", flowType: "C", rendition: { status: "OBSERVED", dueAt: new Date(now - day) } });
      await FinancialRequest.collection.insertMany([
        draft,
        request({ requestNumber: "T-RET", status: "DEVUELTO" }),
        request({ requestNumber: "T-OBS", status: "OBSERVADO_PRESUPUESTO" }),
        soon,
        late,
        request({ requestNumber: "T-REN-SUB", status: "PAGADO", flowType: "C", rendition: { status: "SUBMITTED", dueAt: new Date(now + day) } }),
        request({ requestNumber: "T-REN-CLOSED", status: "CERRADO", flowType: "C", rendition: { status: "PENDING", dueAt: new Date(now - 5 * day) } })
      ]);
      const tasks = await tasksOf("Solicitor");
      assert.equal(tasks.byKey.drafts.count, 1);
      assert.equal(tasks.byKey.drafts.path, `/requests/${draft._id}/edit`, "a single draft opens its editor");
      assert.equal(tasks.byKey.corrections.count, 2);
      assert.equal(tasks.byKey.corrections.path, "/requests?status=DEVUELTO%2COBSERVADO%2COBSERVADO_PRESUPUESTO%2COBSERVADO_SUNAT%2COBSERVADO_MONTO_EXCEDIDO%2COBSERVADO_CARGA_MASIVA");
      const rendition = tasks.byKey.rendition;
      assert.equal(rendition.kind, "submit");
      assert.equal(rendition.count, 2, "submitted and closed renditions are not the requester's work");
      assert.equal(rendition.overdue, 1);
      assert.equal(rendition.tone, "red", "an overdue rendition makes the task urgent");
      assert.equal(new Date(rendition.dueAt).getTime(), late.rendition.dueAt.getTime(), "the earliest deadline is reported");
      assert.equal(rendition.path, "/requests?renditionStatus=PENDING%2COBSERVED");
      await FinancialRequest.deleteOne({ _id: late._id });
      const single = (await tasksOf("Solicitor")).byKey.rendition;
      assert.equal(single.path, `/requests/${soon._id}`, "one rendition opens that request");
      assert.equal(single.overdue, 0);
      assert.equal(single.tone, "amber");

      const accounting = (await tasksOf("Accounting")).byKey.rendition;
      assert.equal(accounting.kind, "review");
      assert.equal(accounting.count, 1, "Accounting reviews submitted renditions");
      assert.equal(accounting.path.startsWith("/requests/"), true);
      assert.equal((await tasksOf("Admin")).byKey.rendition.kind, "outstanding");
      assert.equal((await tasksOf("Accounting")).byKey.drafts, undefined, "draft tasks are the requester's");
      await FinancialRequest.deleteMany({ requestNumber: /^T-/ });
    });

    await t.test("one pending approval opens its decision row; SLA details nest in the approval task", async () => {
      const pending = request({ requestNumber: "T-APR-1", status: "PENDIENTE_APROBACION", approvalStage: "AREA_DIRECTOR", approvalDueAt: new Date(now - 3600000) });
      await FinancialRequest.collection.insertOne(pending);
      const tasks = await tasksOf("AreaDirector");
      assert.equal(tasks.byKey.approval.count, 1);
      assert.equal(tasks.byKey.approval.path, `/approvals?request=${pending._id}`);
      assert.equal(tasks.byKey.approval.overdue, 1);
      assert.equal(tasks.byKey.approval.tone, "red");
      assert.equal(tasks.byKey.approvalOverdue.partOf, "approval");
      assert.equal(tasks.byKey.approvalDueSoon.partOf, "approval");
      assert.equal(tasks.total, 1, "nested SLA details do not double-count the approval");
      await FinancialRequest.collection.insertOne(request({ requestNumber: "T-APR-2", status: "PENDIENTE_APROBACION", approvalStage: "AREA_DIRECTOR", approvalDueAt: new Date(now + 5 * day) }));
      assert.equal((await tasksOf("AreaDirector")).byKey.approval.path, "/approvals");
      await FinancialRequest.deleteMany({ requestNumber: /^T-APR/ });
    });

    await t.test("Treasury sees payables to pay, confirmations and returned payments", async () => {
      const payable = (status, fields = {}) => ({ _id: new mongoose.Types.ObjectId(), status, currency: "PEN", amount: 10, outstandingAmount: 10, request: new mongoose.Types.ObjectId(), ...fields });
      const bounced = payable("PAYMENT_BOUNCED");
      await AccountsPayable.collection.insertMany([payable("OPEN", { dueDate: new Date(now + 3 * day) }), payable("SCHEDULED", { dueDate: new Date(now + day) }), payable("PAYMENT_FILE_CREATED"), bounced]);
      const tasks = await tasksOf("Treasury");
      assert.equal(tasks.byKey.payable.count, 2);
      assert.equal(tasks.byKey.payable.path, "/treasury?tab=prepare");
      assert.equal(new Date(tasks.byKey.payable.dueAt).getTime() < now + 2 * day, true, "the next payable due date is reported");
      assert.equal(tasks.byKey.paymentConfirmation.path.startsWith("/treasury?tab=confirm&record="), true);
      assert.equal(tasks.byKey.bouncedPayments.count, 1);
      assert.equal(tasks.byKey.bouncedPayments.path, `/treasury?tab=returned&record=${bounced._id}`);
      await AccountsPayable.deleteMany({});
    });

    await t.test("Management decides reviewed budget exceptions from the Approval Inbox", async () => {
      const open = request({ requestNumber: "T-EXC-OPEN", status: "OBSERVADO_PRESUPUESTO" });
      const other = request({ requestNumber: "T-EXC-OTHER", status: "OBSERVADO_PRESUPUESTO" });
      const voided = request({ requestNumber: "T-EXC-VOID", status: "ANULADO" });
      await FinancialRequest.collection.insertMany([open, other, voided]);
      const exception = (req, fields = {}) => ({ request: req._id, dimensionKey: `k-${new mongoose.Types.ObjectId()}`, costCenter: new mongoose.Types.ObjectId(), strategy: "EXTRAORDINARY_APPROVAL", availableAmount: 0, requestedAmount: 100, requestedBy: users.Budget._id, history: [{ action: "CREATED", by: users.Budget._id }], ...fields });
      const reviewed = { preparedAt: new Date(), preparedBy: users.Budget._id, preparationComments: "Recommended" };
      const [ready] = await BudgetException.create([
        exception(open, reviewed),
        exception(other),
        exception(voided, reviewed),
        exception(other, { ...reviewed, preparedBy: users.Management._id })
      ]);

      const tasks = await tasksOf("Management");
      assert.equal(tasks.byKey.budgetExceptions.count, 2, "only reviewed exceptions on open requests");
      assert.equal(tasks.byKey.budgetExceptions.path, "/approvals#budget-exceptions");

      const queue = await call("Management", "/dashboard/decisions/budget-exceptions");
      assert.equal(queue.status, 200);
      assert.equal(queue.body.total, 2);
      assert.equal(queue.body.canDecide, true);
      const byRequest = Object.fromEntries(queue.body.data.map((row) => [row.request.requestNumber, row]));
      assert.equal(byRequest["T-EXC-OPEN"].canDecide, true);
      assert.equal(byRequest["T-EXC-OPEN"].path, `/budget?tab=exceptions&record=${ready._id}`);
      assert.equal(byRequest["T-EXC-OPEN"].preparationComments, "Recommended");
      assert.equal(byRequest["T-EXC-OTHER"].canDecide, false, "Management cannot decide an exception it prepared");

      const admin = await call("Admin", "/dashboard/decisions/budget-exceptions");
      assert.equal(admin.status, 200);
      assert.equal(admin.body.canDecide, false, "Admin reads the queue but never decides");
      assert.equal(admin.body.data.every((row) => row.canDecide === false), true);
      for (const role of ["Budget", "Solicitor", "AreaDirector"]) assert.equal((await call(role, "/dashboard/decisions/budget-exceptions")).status, 403, `${role} has no decision queue`);

      const decided = await call("Management", `/budget/exceptions/${ready._id}/decision`, "POST", { status: "APPROVED", comments: "Authorized from the inbox" });
      assert.equal(decided.status, 200);
      assert.equal(decided.body.data.status, "APPROVED");
      assert.equal((await call("Management", "/dashboard/decisions/budget-exceptions")).body.total, 1);
      assert.equal((await tasksOf("Management")).byKey.budgetExceptions.count, 1);

      const budget = (await tasksOf("Budget")).byKey.budgetExceptions;
      assert.equal(budget.count, 2, "Budget still sees every open exception, reviewed or not");
      assert.equal(budget.path, "/budget?tab=exceptions&exceptionStatus=PENDING");
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
