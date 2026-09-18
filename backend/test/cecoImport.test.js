import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CostCenter from "../src/models/CostCenter.js";
import User from "../src/models/User.js";
import { applyCecoImport, createCecoImportPlan, normalizeDni } from "../src/services/cecoImportService.js";

function row(sourceRow, dni, employeeName, cecoCode, area, organizationalUnit = "RECTORADO", organizationalUnitCode = "20002") {
  return { sourceRow, dni: normalizeDni(dni), employeeName, cecoCode, area, organizationalUnit, organizationalUnitCode };
}

test("UMA CeCo import is safe, auditable and idempotent", { timeout: 120000 }, async (t) => {
  const database = `erp_ceco_import_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  try {
    const demo = await CostCenter.create({ code: "CC-ADM-FIN-401", name: "Administración y Finanzas (Demo)", area: "Demo", active: true });
    const authorized = await CostCenter.create({ code: "KEEP-01", name: "Authorized", area: "Existing", active: true });
    const matched = await User.create({ dni: "12345678", name: "ANA TORRES DIAZ", email: "ana@test.invalid", passwordHash: "unused", costCenter: demo._id, authorizedCostCenters: [authorized._id] });
    await User.create({ employeeCode: "87654321", name: "LUIS PEREZ", email: "luis-a@test.invalid", passwordHash: "unused" });
    await User.create({ dni: "87654321", name: "LUIS PEREZ", email: "luis-b@test.invalid", passwordHash: "unused" });
    const requestId = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection("financialrequests").insertOne({
      _id: requestId,
      requesterCostCenter: demo._id,
      requesterCostCenterSnapshot: { code: demo.code, name: demo.name, area: demo.area },
      lines: [{ costCenter: demo._id, costCenterSnapshot: { code: demo.code, name: demo.name, area: demo.area } }]
    });

    const rows = [
      row(2, "12345678", "ANA TORRES DIAZ", "10001", "TESORERIA", "GERENCIA ADMINISTRACION FINANCIERA", "20007"),
      row(3, "11111111", "UNMATCHED EMPLOYEE", "10001", "TESORERIA", "GERENCIA ADMINISTRACION FINANCIERA", "20007"),
      row(4, "87654321", "LUIS PEREZ", "10002", "CONTABILIDAD", "GERENCIA ADMINISTRACION FINANCIERA", "20007"),
      row(5, "22222222", "FIRST", "50103", "EP DE FARMACIA", "VICERRECTORADO CCSS", "20005"),
      row(6, "33333333", "SECOND", "50103", "EP DE PSICOLOGIA", "VICERRECTORADO CCSS", "20005")
    ];

    let plan;
    await t.test("duplicates collapse to one CeCo while conflicting metadata is held", async () => {
      plan = createCecoImportPlan({ rows, users: await User.find({}).lean(), existingCenters: await CostCenter.find({}).lean(), source: "test.xlsx", sheetName: "CeCos" });
      assert.equal(plan.uniqueCecoCodes, 3);
      assert.equal(plan.cecoRecords.length, 2);
      assert.equal(plan.validation.duplicateCecoCodes.find((item) => item.code === "10001").conflict, false);
      assert.equal(plan.validation.cecoConflicts[0].code, "50103");
      assert.equal(plan.demoCentersToDeactivate.length, 1);
    });

    await t.test("DNI assignment preserves authorized CeCos and unsafe matches remain in review", async () => {
      assert.equal(plan.assignments.length, 1);
      assert.equal(plan.assignments[0].cecoCode, "10001");
      assert.equal(plan.validation.unmatchedEmployees.length, 1);
      assert.equal(plan.validation.ambiguousEmployees.length, 3);
      await applyCecoImport(plan, new Date("2026-09-18T12:00:00Z"));
      const saved = await User.findById(matched._id);
      const assignedCenter = await CostCenter.findById(saved.costCenter);
      assert.equal(assignedCenter.code, "10001");
      assert.deepEqual(saved.authorizedCostCenters.map(String), [String(authorized._id)]);
      assert.equal(saved.costCenterAssignment.matchedBy, "DNI");
    });

    await t.test("demo CeCos are deactivated and historical snapshots never change", async () => {
      const inactiveDemo = await CostCenter.findById(demo._id);
      assert.equal(inactiveDemo.active, false);
      assert.equal(inactiveDemo.importProvenance.source, "test.xlsx");
      assert.equal(inactiveDemo.importProvenance.status, "INACTIVE");
      const historical = await mongoose.connection.db.collection("financialrequests").findOne({ _id: requestId });
      assert.equal(historical.lines[0].costCenterSnapshot.name, "Administración y Finanzas (Demo)");
      assert.equal(historical.requesterCostCenterSnapshot.name, "Administración y Finanzas (Demo)");
    });

    await t.test("repeated import does not duplicate centers or change safe authorization", async () => {
      const before = await CostCenter.countDocuments({ code: { $in: ["10001", "10002"] } });
      const repeated = createCecoImportPlan({ rows, users: await User.find({}).lean(), existingCenters: await CostCenter.find({}).lean(), source: "test.xlsx", sheetName: "CeCos" });
      assert.equal(repeated.centersToInsert.length, 0);
      await applyCecoImport(repeated, new Date("2026-09-19T12:00:00Z"));
      assert.equal(await CostCenter.countDocuments({ code: { $in: ["10001", "10002"] } }), before);
      assert.deepEqual((await User.findById(matched._id)).authorizedCostCenters.map(String), [String(authorized._id)]);
    });
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
