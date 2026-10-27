import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";
import { createEmployeeReimbursementBankAccount, updateEmployeeReimbursementBankAccount, reviewEmployeeReimbursementBankAccount, deactivateEmployeeReimbursementBankAccount } from "../src/services/employeeReimbursementBankService.js";
import { notifyEmployeeBankReview } from "../src/services/bankNotificationService.js";
import { countUnreadNotifications, listUserNotifications, markAllNotificationsRead, markNotificationRead, notifyUser } from "../src/services/notificationService.js";

test("bank notifications reach authorized reviewers and owners throughout the profile lifecycle", { timeout: 30000 }, async () => {
  const dbName = `erp_notification_bell_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`, { serverSelectionTimeoutMS: 5000 });
  try {
    await Notification.init();
    const makeUser = (role, suffix, active = true) => User.create({ name: suffix, email: `${suffix}@test.local`, passwordHash: "unused", role, area: "Finance", active });
    const owner = await makeUser("Solicitor", "owner");
    const reviewer = await makeUser("Accounting", "reviewer");
    const admin = await makeUser("Admin", "admin");
    const other = await makeUser("Solicitor", "other");
    const treasury = await makeUser("Treasury", "treasury");
    const inactive = await makeUser("Accounting", "inactive", false);
    const req = { headers: {}, ip: "127.0.0.1" };
    const account = await createEmployeeReimbursementBankAccount({ user: owner, req, payload: { bank: "BCP", currency: "PEN", accountHolderName: "Owner", accountNumber: "1234567890", cci: "12345678901234567890", preferred: true } });
    await notifyEmployeeBankReview(account);
    assert.equal(await countUnreadNotifications(reviewer._id), 1, "Repeated delivery is idempotent");
    assert.equal(await countUnreadNotifications(admin._id), 1);
    for (const user of [owner, other, treasury, inactive]) assert.equal(await countUnreadNotifications(user._id), 0);
    const [alert] = await listUserNotifications(reviewer._id);
    assert.equal(alert.path, `/reimbursement-bank?record=${account._id}`);
    assert.ok(!alert.message.includes("1234567890"), "No account or CCI in the bell");
    assert.equal(await markNotificationRead(alert._id, other._id), null, "A user cannot change another user's notification");
    await markNotificationRead(alert._id, reviewer._id);
    assert.equal(await countUnreadNotifications(reviewer._id), 0);
    const replacement = await updateEmployeeReimbursementBankAccount({ accountId: account._id, user: owner, req, payload: { accountNumber: "1234567891" } });
    assert.equal(await countUnreadNotifications(reviewer._id), 1);
    assert.equal((await listUserNotifications(admin._id)).length, 1, "Old profile's alert is resolved");
    const reviewed = await reviewEmployeeReimbursementBankAccount({ accountId: replacement._id, user: reviewer, req, payload: { result: "OBSERVED", comments: "Please correct the account holder." } });
    assert.equal(reviewed.verificationComments, "Please correct the account holder.");
    assert.equal(await countUnreadNotifications(reviewer._id), 0);
    const [decision] = await listUserNotifications(owner._id);
    assert.equal(decision.type, "EMPLOYEE_BANK_DECISION");
    assert.equal(decision.path, `/reimbursement-bank?record=${replacement._id}`);
    assert.equal(await countUnreadNotifications(other._id), 0);
    const next = await updateEmployeeReimbursementBankAccount({ accountId: replacement._id, user: owner, req, payload: { accountHolderName: "Corrected Owner" } });
    await deactivateEmployeeReimbursementBankAccount({ accountId: next._id, user: owner, req });
    assert.equal(await countUnreadNotifications(admin._id), 0);
    for (let index = 0; index < 25; index++) await notifyUser({ userId: reviewer._id, eventKey: `sample:${index}`, type: "TEST", title: "Pending request", message: "Review request", path: "/requests" });
    assert.equal((await listUserNotifications(reviewer._id, { limit: 20 })).length, 20);
    assert.equal(await countUnreadNotifications(reviewer._id), 25, "Unread count is not capped at page size");
    const [first] = await listUserNotifications(reviewer._id, { limit: 1 });
    await markNotificationRead(first._id, reviewer._id);
    assert.equal((await listUserNotifications(reviewer._id, { limit: 1 }))[0].readAt, undefined, "Unread entries sort before read entries");
    await markAllNotificationsRead(reviewer._id);
    assert.equal(await countUnreadNotifications(reviewer._id), 0);
    assert.equal(await countUnreadNotifications(owner._id), 1, "Mark all affects only the current user");
  } finally {
    // Only the unique database created by this test is removed.
    if (mongoose.connection.name === dbName) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
