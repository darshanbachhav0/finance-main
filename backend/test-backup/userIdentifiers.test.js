import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { updateUser } from "../src/controllers/userController.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

test("role edits tolerate blank optional unique identifiers", async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_user_identifiers_${process.pid}_${Date.now()}`);
  try {
    await User.init();
    const admin = await User.create({ name: "Admin", dni: "10000001", role: "Admin", passwordHash: "test" });
    // Reproduce a pre-existing empty string saved by the old form.
    await User.collection.updateOne({ _id: admin._id }, { $set: { employeeCode: "", email: "" } });
    const user = await User.create({ name: "Manager", dni: "10000002", role: "Solicitor", passwordHash: "test" });
    await t.test("updates the role without colliding with historical blanks", async () => {
      let error;
      const res = { json(value) { this.body = value; } };
      await updateUser({ params: { id: user.id }, user: admin, body: { role: "ViceRector", employeeCode: "", email: "   " }, headers: {} }, res, (err) => { error = err; });
      assert.equal(error, undefined);
      const saved = await User.collection.findOne({ _id: user._id });
      assert.equal(saved.role, "ViceRector");
      assert.equal(saved.approvalLevel, "VICE_RECTOR");
      assert.equal(Object.hasOwn(saved, "employeeCode"), false);
      assert.equal(Object.hasOwn(saved, "email"), false);
    });
    await t.test("normalizes real identifiers and preserves uniqueness", async () => {
      user.employeeCode = " abc ";
      user.email = " Manager@Example.test ";
      await user.save();
      assert.equal(user.employeeCode, "ABC");
      assert.equal(user.email, "manager@example.test");
      await assert.rejects(User.create({ name: "Duplicate", role: "Solicitor", passwordHash: "test", employeeCode: "abc" }), { code: 11000 });
    });
    await t.test("clearing optional identifiers removes stored keys", async () => {
      user.employeeCode = null;
      user.email = "";
      await user.save();
      const saved = await User.collection.findOne({ _id: user._id });
      assert.equal(Object.hasOwn(saved, "employeeCode"), false);
      assert.equal(Object.hasOwn(saved, "email"), false);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("duplicate identity errors identify the field without exposing its value", () => {
  for (const field of ["employeeCode", "dni", "email"]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    errorHandler({ code: 11000, keyPattern: { [field]: 1 }, keyValue: { [field]: "private-value" } }, {}, res);
    assert.equal(res.code, 409);
    assert.deepEqual(res.body.details, { field });
    assert.match(res.body.message, /already in use/);
    assert.equal(JSON.stringify(res.body).includes("private-value"), false);
  }
});
