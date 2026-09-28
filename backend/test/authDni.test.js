import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import { login, loginLockoutPolicy, logout } from "../src/controllers/authController.js";
import { protect } from "../src/middleware/auth.js";

// Resolves with the error passed to next() (undefined on success).
function runMiddleware(middleware, req) {
  return new Promise((resolve) => { middleware(req, fakeRes(), (error) => resolve(error)); });
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

async function callLogin(body) {
  const res = fakeRes();
  let caught;
  await login({ body }, res, (error) => { caught = error; });
  return { res, error: caught };
}

test("DNI-based login", { timeout: 60000 }, async (t) => {
  const databaseName = `erp_auth_dni_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    const passwordHash = await bcrypt.hash("Correct-Horse-1!", 12);
    await User.create({ name: "DNI User", dni: "12345678", email: "dni.user@example.test", passwordHash, role: "Solicitor", active: true });

    await t.test("logs in with a valid DNI and password", async () => {
      const { res, error } = await callLogin({ dni: "12345678", password: "Correct-Horse-1!" });
      assert.equal(error, undefined);
      assert.ok(res.body?.token);
      assert.equal(res.body?.user?.dni, "12345678");
    });

    await t.test("rejects a valid DNI with the wrong password", async () => {
      const { error } = await callLogin({ dni: "12345678", password: "wrong" });
      assert.equal(error?.statusCode, 401);
    });

    await t.test("rejects an unknown DNI", async () => {
      const { error } = await callLogin({ dni: "00000000", password: "Correct-Horse-1!" });
      assert.equal(error?.statusCode, 401);
    });

    await t.test("still accepts the email fallback during the transition window", async () => {
      const { res, error } = await callLogin({ email: "dni.user@example.test", password: "Correct-Horse-1!" });
      assert.equal(error, undefined);
      assert.ok(res.body?.token);
    });

    await t.test("requires a password", async () => {
      const { error } = await callLogin({ dni: "12345678" });
      assert.equal(error?.statusCode, 400);
    });

    await t.test("audits successful and failed sign-ins without storing the password", async () => {
      const user = await User.findOne({ dni: "12345678" });
      assert.ok(await AuditLog.exists({ module: "AUTH", action: "LOGIN_SUCCEEDED", entityId: user._id }));
      const failed = await AuditLog.findOne({ module: "AUTH", action: "LOGIN_FAILED", entityId: user._id });
      assert.ok(failed);
      assert.equal(failed.blocked, true);
      assert.ok(await AuditLog.exists({ module: "AUTH", action: "LOGIN_FAILED", "newValues.identifier": "00000000" }), "unknown accounts are audited too");
      const all = JSON.stringify(await AuditLog.find({ module: "AUTH" }).lean());
      assert.equal(all.includes("Correct-Horse-1!"), false);
      assert.equal(all.includes("wrong"), false);
    });

    await t.test("locks the account after repeated failures, then unlocks after the window", async () => {
      const { maxAttempts } = loginLockoutPolicy();
      assert.equal(maxAttempts, 5);
      await User.create({ name: "Lock User", dni: "87654321", passwordHash: await bcrypt.hash("Right-Password-1!", 12), role: "Solicitor", active: true });
      // A success resets the counter.
      for (let attempt = 1; attempt < maxAttempts; attempt++) assert.equal((await callLogin({ dni: "87654321", password: "nope" })).error?.statusCode, 401);
      assert.equal((await callLogin({ dni: "87654321", password: "Right-Password-1!" })).error, undefined);
      assert.equal((await User.findOne({ dni: "87654321" })).failedLoginAttempts, 0);
      for (let attempt = 1; attempt < maxAttempts; attempt++) assert.equal((await callLogin({ dni: "87654321", password: "nope" })).error?.statusCode, 401);
      const locking = await callLogin({ dni: "87654321", password: "nope" });
      assert.equal(locking.error?.statusCode, 429);
      assert.equal(locking.error?.code, "ACCOUNT_LOCKED");
      const locked = await User.findOne({ dni: "87654321" });
      assert.ok(locked.lockedUntil.getTime() > Date.now() + 14 * 60000 && locked.lockedUntil.getTime() <= Date.now() + 15 * 60000);
      // Even the right password is refused while locked, and the lock is audited.
      assert.equal((await callLogin({ dni: "87654321", password: "Right-Password-1!" })).error?.code, "ACCOUNT_LOCKED");
      assert.ok(await AuditLog.exists({ module: "AUTH", action: "ACCOUNT_LOCKED", entityId: locked._id }));
      assert.ok(await AuditLog.exists({ module: "AUTH", action: "LOGIN_LOCKED", entityId: locked._id }));
      assert.equal(JSON.stringify(locked.toJSON()).includes("lockedUntil"), false, "lockout state never reaches the client");
      await User.updateOne({ _id: locked._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
      assert.equal((await callLogin({ dni: "87654321", password: "Right-Password-1!" })).error, undefined);
      const unlocked = await User.findOne({ dni: "87654321" });
      assert.equal(unlocked.lockedUntil, null);
    });

    await t.test("logout revokes the session server-side", async () => {
      const { res } = await callLogin({ dni: "12345678", password: "Correct-Horse-1!" });
      const request = { headers: { authorization: `Bearer ${res.body.token}` }, originalUrl: "/api/requests" };
      const authenticated = await runMiddleware(protect, request);
      assert.equal(authenticated, undefined);
      const out = fakeRes();
      let failure;
      await logout({ user: request.user, headers: {} }, out, (error) => { failure = error; });
      assert.equal(failure, undefined);
      assert.equal(out.body.success, true);
      assert.equal((await runMiddleware(protect, { ...request, user: undefined }))?.statusCode, 401, "the old token no longer works");
      assert.ok(await AuditLog.exists({ module: "AUTH", action: "LOGOUT", entityId: request.user._id }));
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
