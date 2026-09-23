import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { login } from "../src/controllers/authController.js";

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
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
