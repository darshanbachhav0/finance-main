import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import AccountingMapping from "../src/models/AccountingMapping.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { notifyUser, recordLinkFor } from "../src/services/notificationService.js";
import { deepLinkFilter } from "../src/services/queryService.js";
import { countEscalatedApprovals } from "../src/services/slaMonitoringService.js";
import { isApprovalEscalated } from "../src/services/slaPolicy.js";
import { addWorkingDays } from "../src/services/businessCalendarService.js";
import { clearManagementApiCache, managementSnapshot } from "../src/services/externalManagementService.js";

const PURPOSES = ["ACCOUNTS_PAYABLE", "BANK", "ADVANCE_TRANSIT", "IGV", "RETURN_RECEIVABLE", "SUPPLIER_CREDIT", "EXCHANGE_GAIN", "EXCHANGE_LOSS"];

test("notification links name the exact record", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(recordLinkFor("/treasury", "AccountsPayable", id), `/treasury?record=${id}`);
  assert.equal(recordLinkFor("/treasury", "FinancialRequest", id), `/treasury?request=${id}`);
  assert.equal(recordLinkFor("/budget", "BudgetException", id), `/budget?tab=exceptions&record=${id}`);
  assert.equal(recordLinkFor("/budget", "FinancialRequest", id), `/requests/${id}`, "a request-level budget problem opens the request");
  assert.equal(recordLinkFor(`/treasury?tab=confirm&record=${id}`, "FinancialRequest", id), `/treasury?tab=confirm&record=${id}`, "an explicit link is kept");
  assert.equal(recordLinkFor(`/requests/${id}`, "FinancialRequest", id), `/requests/${id}`);
  assert.deepEqual(deepLinkFilter({}), {});
  assert.equal(String(deepLinkFilter({ record: String(id) })._id), String(id));
  assert.throws(() => deepLinkFilter({ record: "not-an-id" }), (error) => error.statusCode === 422);
  assert.equal(PURPOSES.length, AccountingMapping.schema.path("purpose").enumValues.length, "the admin screen covers every purpose");
  assert.deepEqual([...AccountingMapping.schema.path("purpose").enumValues].sort(), [...PURPOSES].sort());
});

test("SLA escalation counters use working days, like the SLA worker", () => {
  const config = { dueSoonHours: 4, escalationWorkingDays: 1 };
  const friday = new Date("2026-09-18T17:00:00Z");
  // 49 calendar hours later is Sunday: overdue, but not escalated in working days.
  assert.equal(isApprovalEscalated(friday, new Date(friday.getTime() + 49 * 3600000), config), false);
  assert.equal(isApprovalEscalated(friday, addWorkingDays(friday, 1), config), true);
  assert.equal(isApprovalEscalated(null, new Date(), config), false);
  assert.equal(isApprovalEscalated(new Date(Date.now() + 3600000), new Date(), config), false);
});

test("mapping API authorization, deep-link filters and escalation counters", { timeout: 60000 }, async (t) => {
  const database = `erp_notification_links_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const roles = ["Admin", "Accounting", "Treasury", "Solicitor", "Budget"];
    const users = Object.fromEntries((await User.create(roles.map((role) => ({ name: role, email: `${role.toLowerCase()}-links@test.local`, passwordHash: "unused", role })))).map((user) => [user.role, user]));
    const call = async (role, path, method = "GET", body) => {
      const token = jwt.sign({ id: users[role]._id }, process.env.JWT_SECRET || "dev_secret_change_me");
      const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    };

    await t.test("only Admin and Accounting read or maintain accounting mappings", async () => {
      for (const role of ["Treasury", "Solicitor", "Budget"]) {
        assert.equal((await call(role, "/accounting-mappings")).status, 403, `${role} cannot list mappings`);
        assert.equal((await call(role, "/accounting-mappings", "POST", { code: "X", name: "X", purpose: "BANK", accountNumber: "1041" })).status, 403, `${role} cannot create mappings`);
      }
      const created = [];
      for (const [index, purpose] of PURPOSES.entries()) {
        const result = await call(index % 2 ? "Admin" : "Accounting", "/accounting-mappings", "POST", { code: `map-${index}`, name: purpose, purpose, accountNumber: String(4000 + index), subAccount: "01", currency: index === 6 ? "USD" : "*", bank: index === 1 ? "BBVA" : "*" });
        assert.equal(result.status, 201, `${purpose} can be created`);
        assert.equal(result.body.data.code, `MAP-${index}`);
        created.push(result.body.data);
      }
      const listed = await call("Accounting", "/accounting-mappings");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.data.length, PURPOSES.length);
      const updated = await call("Accounting", `/accounting-mappings/${created[0]._id}`, "PUT", { accountNumber: "4212", requestType: "*", expenseNature: "*" });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.accountNumber, "4212");
      assert.equal((await call("Treasury", `/accounting-mappings/${created[0]._id}`, "PUT", { accountNumber: "9" })).status, 403);
      const removed = await call("Accounting", `/accounting-mappings/${created[0]._id}`, "DELETE");
      assert.equal(removed.status, 200);
      assert.equal(removed.body.data.active, false, "deactivated, never deleted");
      assert.equal(await AccountingMapping.countDocuments(), PURPOSES.length);
      assert.equal((await call("Accounting", "/accounting-mappings", "POST", { code: "BAD", name: "Bad", purpose: "NOT_A_PURPOSE", accountNumber: "1" })).status >= 400, true);
    });

    await t.test("a bare list path becomes a record link when the notification is stored", async () => {
      const entityId = new mongoose.Types.ObjectId();
      const stored = await notifyUser({ userId: users.Treasury._id, eventKey: "links:test", type: "TREASURY_PAYABLE", title: "t", message: "m", path: "/treasury", entityType: "AccountsPayable", entityId });
      assert.equal(stored.path, `/treasury?record=${entityId}`);
      assert.equal(await Notification.countDocuments({ path: "/treasury" }), 0);
    });

    await t.test("the approval inbox narrows to the linked request", async () => {
      const now = Date.now();
      const requests = [0, 1].map((index) => ({ _id: new mongoose.Types.ObjectId(), requestNumber: `LINK-${index}`, status: "PENDIENTE_APROBACION", approvalStage: "AREA_DIRECTOR", requester: users.Solicitor._id, solicitor: users.Solicitor._id, requesterArea: "Operations", approvalDueAt: new Date(now + 3600000), totalAmount: 100, totalPENEquivalent: 100, currency: "PEN", createdAt: new Date(now - index * 1000) }));
      await FinancialRequest.collection.insertMany(requests);
      const all = await call("Admin", "/approvals/inbox");
      assert.equal(all.status, 200);
      assert.equal(all.body.data.length, 2);
      const linked = await call("Admin", `/approvals/inbox?request=${requests[1]._id}`);
      assert.equal(linked.status, 200);
      assert.deepEqual(linked.body.data.map((row) => row.requestNumber), ["LINK-1"]);
      assert.equal((await call("Admin", "/approvals/inbox?request=bad-id")).status, 422);
      assert.equal((await call("Treasury", `/treasury/queue?record=${requests[0]._id}`)).body.data.length, 0, "an id that is not a CXP lists nothing");
      await FinancialRequest.deleteMany({ requestNumber: /^LINK-/ });
    });

    await t.test("dashboard and management-portal escalation counters share the working-day rule", async () => {
      const now = new Date();
      const base = { status: "PENDIENTE_APROBACION", approvalStage: "AREA_DIRECTOR", requester: users.Solicitor._id, requesterArea: "Operations", totalAmount: 1, currency: "PEN" };
      await FinancialRequest.collection.insertMany([
        { ...base, _id: new mongoose.Types.ObjectId(), requestNumber: "ESC-OLD", approvalDueAt: new Date(now.getTime() - 20 * 86400000) },
        { ...base, _id: new mongoose.Types.ObjectId(), requestNumber: "ESC-RECENT", approvalDueAt: new Date(now.getTime() - 3600000) },
        { ...base, _id: new mongoose.Types.ObjectId(), requestNumber: "ESC-FUTURE", approvalDueAt: new Date(now.getTime() + 86400000) }
      ]);
      assert.equal(await countEscalatedApprovals({ requestNumber: /^ESC-/ }, { now }), 1);
      // A Friday deadline seen on Sunday: 49 calendar hours overdue but not escalated.
      const friday = new Date("2026-09-18T17:00:00Z");
      await FinancialRequest.collection.insertOne({ ...base, _id: new mongoose.Types.ObjectId(), requestNumber: "WKD-1", approvalDueAt: friday });
      assert.equal(await countEscalatedApprovals({ requestNumber: "WKD-1" }, { now: new Date(friday.getTime() + 49 * 3600000), config: { escalationWorkingDays: 1 } }), 0);
      assert.equal(await countEscalatedApprovals({ requestNumber: "WKD-1" }, { now: addWorkingDays(friday, 1), config: { escalationWorkingDays: 1 } }), 1);
      await FinancialRequest.deleteMany({ requestNumber: "WKD-1" });
      clearManagementApiCache();
      const snapshot = await managementSnapshot("sla", {});
      const current = Object.fromEntries((snapshot.data.current).map(({ key, count }) => [key, count]));
      assert.equal(current.LONG_OVERDUE, 1);
      assert.equal(current.OVERDUE, 1);
      assert.equal(current.ON_TRACK, 1);
      const dashboard = await call("Admin", "/dashboard/tasks");
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.body.counters.approvalEscalated, 1, "only the request past its working-day escalation counts");
      assert.equal(dashboard.body.counters.approvalOverdue, 2);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
