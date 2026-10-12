import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import { accountStatus, recoverAccount, temporaryPassword } from "../src/services/accountRecoveryService.js";

test("account recovery clears a sign-in lock, can reactivate, and sets a temporary password", { timeout: 30000 }, async () => {
  const database = `erp_account_recovery_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  try {
    const now = new Date("2026-10-12T16:00:00Z");
    const admin = await User.create({ dni: "10000001", name: "Admin", role: "Admin", passwordHash: "old-hash", failedLoginAttempts: 3, lockedUntil: new Date("2026-10-12T16:10:00Z"), active: false, tokenVersion: 2 });

    const status = accountStatus(await User.findById(admin._id).lean(), now);
    assert.deepEqual({ active: status.active, locked: status.locked, lockedUntil: status.lockedUntil }, { active: false, locked: true, lockedUntil: "2026-10-12T16:10:00.000Z" });
    assert.equal(accountStatus(null), null);
    assert.equal(accountStatus({ ...status, lockedUntil: new Date("2026-10-12T15:00:00Z") }, now).locked, false, "an expired lock is not reported as locked");

    assert.deepEqual(await recoverAccount({ dni: "99999999" }), { found: false, dni: "99999999" });

    const unlocked = await recoverAccount({ dni: "10000001", now });
    assert.equal(unlocked.password, undefined, "the password is kept unless a reset is asked for");
    let saved = await User.findById(admin._id);
    assert.equal(saved.lockedUntil, null);
    assert.equal(saved.failedLoginAttempts, 0);
    assert.equal(saved.active, false, "not reactivated unless asked");
    assert.equal(saved.passwordHash, "old-hash");

    const recovered = await recoverAccount({ dni: "10000001", activate: true, resetPassword: true, now });
    saved = await User.findById(admin._id);
    assert.equal(saved.active, true);
    assert.ok(recovered.password.length >= 10);
    assert.equal(await saved.comparePassword(recovered.password), true);
    assert.equal(saved.passwordResetRequired, true, "the temporary password must be changed at sign-in");
    assert.equal(saved.tokenVersion, 3, "existing sessions are signed out");
    assert.notEqual(temporaryPassword(), temporaryPassword());

    const audits = await AuditLog.find({ action: "ACCOUNT_RECOVERED" }).lean();
    assert.equal(audits.length, 2);
    assert.deepEqual(audits[1].newValues, { active: true, locked: false, passwordReset: true });
    assert.ok(!JSON.stringify(audits).includes(recovered.password), "the password is never audited");
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
