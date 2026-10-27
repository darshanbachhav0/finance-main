import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import { login, logout } from "../src/controllers/authController.js";
import { protect } from "../src/middleware/auth.js";
import { clearPlatformSettingsCache, removeSignInLockout } from "../src/services/platformSettingsService.js";

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

    await t.test("the right password always signs in, however many wrong ones came before", async () => {
      await User.create({ name: "Retry User", dni: "87654321", passwordHash: await bcrypt.hash("Right-Password-1!", 12), role: "Solicitor", active: true });
      for (let attempt = 1; attempt <= 8; attempt++) assert.equal((await callLogin({ dni: "87654321", password: "nope" })).error?.statusCode, 401);
      assert.equal((await callLogin({ dni: "87654321", password: "Right-Password-1!" })).error, undefined);
      const user = await User.findOne({ dni: "87654321" });
      assert.equal(await AuditLog.countDocuments({ module: "AUTH", action: "LOGIN_FAILED", entityId: user._id }), 8, "every wrong password is still audited");
      assert.equal(await AuditLog.exists({ module: "AUTH", action: { $in: ["ACCOUNT_LOCKED", "LOGIN_LOCKED"] } }), null);
    });

    await t.test("an account locked before the lockout was removed signs in again, once migrated", async () => {
      const db = mongoose.connection.db;
      const settings = db.collection("platformsettings");
      const runs = db.collection("migrationruns");
      const now = new Date();
      await db.collection("users").updateOne({ dni: "87654321" }, { $set: { lockedUntil: new Date(now.getTime() + 300000), failedLoginAttempts: 3 } });
      await db.collection("users").updateOne({ dni: "12345678" }, { $set: { lockedUntil: null, failedLoginAttempts: 0 } });
      await settings.insertOne({ key: "platform", passwordPolicy: { minLength: 12, lockoutMinutes: 15, maxFailedAttempts: 5 } });
      assert.deepEqual(await removeSignInLockout({ db, now }), { applied: true, unlocked: 1 });
      assert.equal(await db.collection("users").countDocuments({ $or: [{ lockedUntil: { $exists: true } }, { failedLoginAttempts: { $exists: true } }] }), 0);
      assert.deepEqual((await settings.findOne({ key: "platform" })).passwordPolicy, { minLength: 12 }, "only the lockout settings go");
      assert.deepEqual(await removeSignInLockout({ db, now }), { applied: false, unlocked: 0 }, "it runs once");
      await settings.deleteMany({});
      await runs.deleteMany({});
      clearPlatformSettingsCache();
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
