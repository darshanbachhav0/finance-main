import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import { notificationText, notifyRoles, notifyUser } from "../src/services/notificationService.js";

test("notificationText interpolates named placeholders and keeps the template", () => {
  const copy = notificationText("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber: "SOL-1", approvalLevel: "AREA_DIRECTOR" });
  assert.equal(copy.text, "SOL-1 is waiting for AREA_DIRECTOR approval.");
  assert.equal(copy.key, "{requestNumber} is waiting for {approvalLevel} approval.");
  assert.deepEqual(copy.params, { requestNumber: "SOL-1", approvalLevel: "AREA_DIRECTOR" });
  assert.equal(notificationText("{a} and {missing}", { a: 0 }).text, "0 and {missing}", "Unknown placeholders stay visible; zero is a value");
});

test("notifications store translatable keys and params next to the English text", { timeout: 30000 }, async () => {
  const dbName = `erp_notification_text_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`, { serverSelectionTimeoutMS: 5000 });
  try {
    await Notification.init();
    const treasury = await User.create({ name: "Treasury", email: "treasury@test.local", passwordHash: "unused", role: "Treasury", area: "Finance", active: true });
    await notifyUser({
      userId: treasury._id, eventKey: "text:1", type: "PAYMENT_CONFIRMED",
      title: notificationText("Payment confirmed"),
      message: notificationText("{requestNumber} CXP was paid with operation {operationNumber}.", { requestNumber: "SOL-2026-0001", operationNumber: 4521 }),
      path: "/requests"
    });
    const stored = await Notification.findOne({ user: treasury._id, eventKey: "text:1" }).lean();
    assert.equal(stored.title, "Payment confirmed");
    assert.equal(stored.message, "SOL-2026-0001 CXP was paid with operation 4521.");
    assert.equal(stored.titleKey, "Payment confirmed");
    assert.equal(stored.messageKey, "{requestNumber} CXP was paid with operation {operationNumber}.");
    assert.deepEqual(stored.params, { requestNumber: "SOL-2026-0001", operationNumber: "4521" });

    await notifyRoles({ roles: ["Treasury"], eventKey: "text:2", type: "TREASURY_PAYABLE", title: notificationText("Payable item ready"), message: notificationText("{requestNumber} has an open CXP ready for Treasury scheduling.", { requestNumber: "SOL-9" }) });
    const byRole = await Notification.findOne({ user: treasury._id, eventKey: "text:2" }).lean();
    assert.equal(byRole.message, "SOL-9 has an open CXP ready for Treasury scheduling.");
    assert.equal(byRole.params.requestNumber, "SOL-9");

    await notifyUser({ userId: treasury._id, eventKey: "text:legacy", type: "TEST", title: "Plain title", message: "Plain message" });
    const legacy = await Notification.findOne({ user: treasury._id, eventKey: "text:legacy" }).lean();
    assert.equal(legacy.message, "Plain message");
    assert.equal(legacy.messageKey, undefined, "Plain strings keep the old shape");
    assert.equal(legacy.params, undefined);

    await notifyUser({ userId: treasury._id, eventKey: "text:1", type: "PAYMENT_CONFIRMED", title: "Payment confirmed", message: "Re-sent as plain text" });
    const resent = await Notification.findOne({ user: treasury._id, eventKey: "text:1" }).lean();
    assert.equal(resent.message, "Re-sent as plain text");
    assert.equal(resent.messageKey, undefined, "A re-send without a template drops the stale template");
    assert.equal(resent.params, undefined);
  } finally {
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
