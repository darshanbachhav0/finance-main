import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../src/app.js";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";

const secret = () => process.env.JWT_SECRET || "dev_secret_change_me";

test("session refresh (POST /auth/refresh) and menu counters", { timeout: 60000 }, async (t) => {
  const database = `erp_session_refresh_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, { token, method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    const passwordHash = await bcrypt.hash("Refresh-Password-1!", 10);
    const user = await User.create({ name: "Refresh User", dni: "44556677", email: "refresh.user@test.local", passwordHash, role: "Solicitor", active: true });
    const accountant = await User.create({ name: "Refresh Accountant", dni: "44556678", email: "refresh.accounting@test.local", passwordHash, role: "Accounting", active: true });

    await t.test("login reports when the session expires", async () => {
      const login = await call("/auth/login", { method: "POST", body: { dni: "44556677", password: "Refresh-Password-1!" } });
      assert.equal(login.status, 200);
      const { exp } = jwt.decode(login.body.token);
      assert.equal(login.body.expiresAt, new Date(exp * 1000).toISOString());
      assert.ok(exp * 1000 - Date.now() > 7.9 * 3600000, "sessions last 8 hours");
    });

    await t.test("a valid token gets a fresh one with a later expiry, and the refresh is audited", async () => {
      const current = jwt.sign({ id: user._id, role: user.role, tokenVersion: 0 }, secret(), { expiresIn: "4m" });
      const refreshed = await call("/auth/refresh", { method: "POST", token: current });
      assert.equal(refreshed.status, 200);
      assert.ok(refreshed.body.token && refreshed.body.token !== current);
      assert.equal(refreshed.body.user.dni, "44556677");
      assert.equal(refreshed.body.user.passwordHash, undefined, "the session user never includes the password hash");
      const decoded = jwt.verify(refreshed.body.token, secret());
      assert.equal(String(decoded.id), String(user._id));
      assert.equal(decoded.tokenVersion, 0, "the new token keeps the session's tokenVersion");
      assert.ok(decoded.exp * 1000 - Date.now() > 7.9 * 3600000);
      assert.equal(refreshed.body.expiresAt, new Date(decoded.exp * 1000).toISOString());
      assert.equal((await call("/auth/me", { token: refreshed.body.token })).status, 200, "the new token works");
      const audit = await AuditLog.findOne({ module: "AUTH", action: "SESSION_REFRESHED", entityId: user._id });
      assert.ok(audit, "the refresh is audited");
      assert.equal(JSON.stringify(audit).includes(refreshed.body.token), false, "the token is never written to the audit log");
    });

    await t.test("refresh requires a current, valid token", async () => {
      assert.equal((await call("/auth/refresh", { method: "POST" })).status, 401, "no token");
      const expired = jwt.sign({ id: user._id, role: user.role, tokenVersion: 0, exp: Math.floor(Date.now() / 1000) - 10 }, secret());
      assert.equal((await call("/auth/refresh", { method: "POST", token: expired })).status, 401, "an expired token cannot be extended");
      const forged = jwt.sign({ id: user._id, role: user.role, tokenVersion: 0 }, "not-the-secret", { expiresIn: "1h" });
      assert.equal((await call("/auth/refresh", { method: "POST", token: forged })).status, 401, "a token signed with another secret is refused");
    });

    await t.test("a revoked session (signed out, password changed) cannot be refreshed", async () => {
      const old = jwt.sign({ id: user._id, role: user.role, tokenVersion: 0 }, secret(), { expiresIn: "1h" });
      await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
      assert.equal((await call("/auth/refresh", { method: "POST", token: old })).status, 401);
      const fresh = jwt.sign({ id: user._id, role: user.role, tokenVersion: 1 }, secret(), { expiresIn: "1h" });
      const refreshed = await call("/auth/refresh", { method: "POST", token: fresh });
      assert.equal(refreshed.status, 200);
      assert.equal(jwt.decode(refreshed.body.token).tokenVersion, 1);
      // Signing out afterwards revokes the refreshed token too.
      assert.equal((await call("/auth/logout", { method: "POST", token: refreshed.body.token })).status, 200);
      assert.equal((await call("/auth/refresh", { method: "POST", token: refreshed.body.token })).status, 401);
    });

    await t.test("an inactive account cannot refresh", async () => {
      const token = jwt.sign({ id: accountant._id, role: accountant.role, tokenVersion: 0 }, secret(), { expiresIn: "1h" });
      await User.updateOne({ _id: accountant._id }, { $set: { active: false } });
      assert.equal((await call("/auth/refresh", { method: "POST", token })).status, 401);
      await User.updateOne({ _id: accountant._id }, { $set: { active: true } });
    });

    await t.test("task counters for the menu badges", async () => {
      const solicitor = await User.findById(user._id);
      const solicitorTasks = await call("/dashboard/tasks", { token: jwt.sign({ id: solicitor._id, tokenVersion: solicitor.tokenVersion }, secret(), { expiresIn: "1h" }) });
      assert.equal(solicitorTasks.status, 200);
      assert.equal(solicitorTasks.body.counters.requestCorrections, 0, "a requester sees their returned or observed requests");
      assert.match(solicitorTasks.body.items.find((item) => item.key === "requestCorrections").path, /^\/requests\?status=DEVUELTO%2COBSERVADO/);
      const accountingTasks = await call("/dashboard/tasks", { token: jwt.sign({ id: accountant._id, tokenVersion: 0 }, secret(), { expiresIn: "1h" }) });
      assert.equal(accountingTasks.status, 200);
      assert.equal(accountingTasks.body.counters.invoiceObservations, 0, "Accounting sees open invoice observations");
      assert.equal(accountingTasks.body.counters.requestCorrections, undefined, "corrections are the requester's own task");
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
