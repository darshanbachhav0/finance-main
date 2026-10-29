import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { migrateRetiredRoles } from "../src/services/legacyRoleService.js";
import { RETIRED_ROLES, ROLE_PERMISSIONS, PERMISSIONS, ROLES } from "../src/utils/constants.js";

test("the Budget role is folded into Treasury", async (t) => {
  await t.test("Treasury holds what Budget held; Budget is no longer a role", () => {
    assert.equal(Object.values(ROLES).includes("Budget"), false);
    assert.equal(ROLE_PERMISSIONS.Budget, undefined);
    assert.equal(RETIRED_ROLES.Budget, ROLES.TREASURY);
    for (const permission of [PERMISSIONS.BUDGET_VIEW, PERMISSIONS.BUDGET_MANAGE, PERMISSIONS.REQUEST_VIEW, PERMISSIONS.REPORT_VIEW]) {
      assert.ok(ROLE_PERMISSIONS[ROLES.TREASURY].includes(permission), `Treasury has ${permission}`);
    }
    assert.ok(!ROLE_PERMISSIONS[ROLES.TREASURY].includes(PERMISSIONS.PURCHASE_ORDER_ISSUE), "orders are a separate grant");
  });

  await t.test("stored users, previous roles and approval rules move to Treasury once, with an audit entry", async () => {
    const databaseName = `erp_retired_roles_${process.pid}_${Date.now()}`;
    await mongoose.connect(`mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`);
    try {
      const db = mongoose.connection.db;
      const { insertedIds } = await db.collection("users").insertMany([
        { name: "Old budget officer", role: "Budget" },
        { name: "Acting approver", role: "AreaDirector", previousRole: "Budget" },
        { name: "Accountant", role: "Accounting" }
      ]);
      await db.collection("approvalrules").insertMany([{ name: "Budget stage", role: "Budget" }, { name: "Director stage", role: "AreaDirector" }]);

      const dryRun = await migrateRetiredRoles({ apply: false, db });
      assert.deepEqual(dryRun.Budget, { replacement: "Treasury", users: 1, previousRoles: 1, approvalRules: 1 });
      assert.equal(await db.collection("users").countDocuments({ role: "Budget" }), 1, "a dry run changes nothing");

      await migrateRetiredRoles({ db });
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[0] })).role, "Treasury");
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[1] })).previousRole, "Treasury");
      assert.equal((await db.collection("users").findOne({ _id: insertedIds[2] })).role, "Accounting");
      assert.equal(await db.collection("approvalrules").countDocuments({ role: "Budget" }), 0);
      assert.equal(await db.collection("approvalrules").countDocuments({ role: "Treasury" }), 1);
      const audit = await db.collection("auditlogs").findOne({ entityId: insertedIds[0], action: "ROLE_RETIRED" });
      assert.deepEqual([audit.oldValues.role, audit.newValues.role], ["Budget", "Treasury"]);

      const again = await migrateRetiredRoles({ db });
      assert.deepEqual(again.Budget, { replacement: "Treasury", users: 0, previousRoles: 0, approvalRules: 0 });
      assert.equal(await db.collection("auditlogs").countDocuments({ action: "ROLE_RETIRED" }), 1, "running it again changes nothing");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
});
