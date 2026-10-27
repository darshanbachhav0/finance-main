import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CostCenter from "../src/models/CostCenter.js";
import User from "../src/models/User.js";
import { applyCecoImport, createCecoImportPlan, normalizeDni } from "../src/services/cecoImportService.js";

function row(sourceRow, dni, employeeName, cecoCode, area, organizationalUnit = "RECTORADO", organizationalUnitCode = "20002") {
  return { sourceRow, dni: normalizeDni(dni), employeeName, cecoCode, area, organizationalUnit, organizationalUnitCode };
}

test("UMA CeCo import: the workbook sets each person's only CeCo and area, and replaces the CeCo master", { timeout: 120000 }, async (t) => {
  const database = `erp_ceco_import_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  try {
    const demo = await CostCenter.create({ code: "CC-ADM-FIN-401", name: "Administración y Finanzas (Demo)", area: "Demo", active: true });
    const authorized = await CostCenter.create({ code: "KEEP-01", name: "Authorized", area: "Existing", active: true });
    const matched = await User.create({ dni: "12345678", name: "ANA TORRES DIAZ", email: "ana@test.invalid", passwordHash: "unused", area: "General", costCenter: demo._id, authorizedCostCenters: [authorized._id] });
    await User.create({ employeeCode: "87654321", name: "LUIS PEREZ", email: "luis-a@test.invalid", passwordHash: "unused" });
    await User.create({ dni: "87654321", name: "LUIS PEREZ", email: "luis-b@test.invalid", passwordHash: "unused" });
    const pharmacy = await User.create({ dni: "22222222", name: "FIRST", email: "first@test.invalid", passwordHash: "unused" });
    const psychology = await User.create({ dni: "33333333", name: "SECOND", email: "second@test.invalid", passwordHash: "unused" });
    const psychology2 = await User.create({ dni: "44444444", name: "THIRD", email: "third@test.invalid", passwordHash: "unused" });
    // Stored without the leading zero Excel drops; written differently from the workbook.
    const sevenDigits = await User.create({ dni: "9874299", name: "Julio César Villar", email: "julio@test.invalid", passwordHash: "unused" });
    const outsider = await User.create({ dni: "55555555", name: "NOT IN WORKBOOK", email: "outsider@test.invalid", passwordHash: "unused", costCenter: authorized._id });
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
      row(6, "33333333", "SECOND", "50103", "EP DE PSICOLOGIA", "VICERRECTORADO CCSS", "20005"),
      row(7, "44444444", "THIRD", "50103", "EP DE PSICOLOGIA", "VICERRECTORADO CCSS", "20005"),
      row(8, "9874299", "VILLAR BARNUEVO JULIO CESAR", "30015", "DIRECCION DE ESTUDIOS GENERALES", "VICERRECTORADO ACADEMICO IINN", "20009")
    ];
    const plan = () => User.find({}).lean().then(async (users) => createCecoImportPlan({ rows, users, existingCenters: await CostCenter.find({}).lean(), source: "test.xlsx", sheetName: "CeCos" }));

    let first;
    await t.test("every CeCo in the workbook is imported; one with several areas is named by the most frequent and reported", async () => {
      first = await plan();
      assert.equal(first.uniqueCecoCodes, 4);
      assert.equal(first.cecoRecords.length, 4);
      const shared = first.cecoRecords.find((item) => item.code === "50103");
      assert.equal(shared.name, "EP DE PSICOLOGIA");
      assert.equal(first.validation.cecoConflicts[0].code, "50103");
      assert.equal(first.validation.cecoConflicts[0].appliedName, "EP DE PSICOLOGIA");
      assert.equal(first.validation.duplicateCecoCodes.find((item) => item.code === "10001").conflict, false);
      assert.deepEqual(first.centersToDeactivate.map((item) => item.code).sort(), ["CC-ADM-FIN-401", "KEEP-01"], "every CeCo missing from the workbook, not only demo ones");
    });

    await t.test("people are matched by DNI; unsafe matches are skipped and reported", async () => {
      assert.deepEqual(first.assignments.map((item) => item.dni).sort(), ["09874299", "12345678", "22222222", "33333333", "44444444"]);
      assert.equal(first.validation.unmatchedEmployees.length, 1);
      assert.deepEqual(first.validation.ambiguousEmployees.map((item) => item.dni), ["87654321"], "two accounts share LUIS PEREZ's DNI");
      assert.deepEqual(first.validation.nameDifferences.map((item) => item.dni), ["09874299"], "a differently written name is applied and reported");
      assert.deepEqual(first.validation.usersOnDeactivatedCenters.map((item) => item.dni), ["55555555"]);
    });

    await t.test("applying gives each person the workbook CeCo as their only CeCo and their own AREA", async () => {
      const result = await applyCecoImport(first, new Date("2026-09-18T12:00:00Z"));
      assert.equal(result.employeesAssigned, 5);
      const saved = await User.findById(matched._id).populate("costCenter");
      assert.equal(saved.costCenter.code, "10001");
      assert.equal(saved.area, "TESORERIA");
      assert.deepEqual(saved.authorizedCostCenters, [], "earlier authorized CeCos are removed");
      assert.equal(saved.costCenterAssignment.matchedBy, "DNI");
      assert.equal(saved.costCenterAssignment.sourceRow, 2);
      // Both people on the shared number keep their own area.
      assert.equal((await User.findById(pharmacy._id)).area, "EP DE FARMACIA");
      assert.equal((await User.findById(psychology._id)).area, "EP DE PSICOLOGIA");
      assert.equal(String((await User.findById(pharmacy._id)).costCenter), String((await User.findById(psychology2._id)).costCenter));
      const julio = await User.findById(sevenDigits._id).populate("costCenter");
      assert.equal(julio.costCenter.code, "30015");
      assert.equal(julio.dni, "9874299", "the stored DNI, the login identifier, is never rewritten");
    });

    await t.test("CeCos missing from the workbook are deactivated, never deleted, and history keeps its snapshots", async () => {
      for (const id of [demo._id, authorized._id]) {
        const center = await CostCenter.findById(id);
        assert.equal(center.active, false);
        assert.equal(center.importProvenance.status, "INACTIVE");
      }
      const historical = await mongoose.connection.db.collection("financialrequests").findOne({ _id: requestId });
      assert.equal(historical.lines[0].costCenterSnapshot.name, "Administración y Finanzas (Demo)");
      assert.equal(historical.requesterCostCenterSnapshot.name, "Administración y Finanzas (Demo)");
      assert.equal(String((await User.findById(outsider._id)).costCenter), String(authorized._id), "people outside the workbook are reported, not changed");
    });

    await t.test("a repeated import changes nothing", async () => {
      const before = await CostCenter.countDocuments();
      const repeated = await plan();
      assert.equal(repeated.centersToInsert.length, 0);
      assert.equal(repeated.centersToDeactivate.length, 0);
      await applyCecoImport(repeated, new Date("2026-09-19T12:00:00Z"));
      assert.equal(await CostCenter.countDocuments(), before);
      const saved = await User.findById(matched._id).populate("costCenter");
      assert.equal(saved.costCenter.code, "10001");
      assert.equal(saved.area, "TESORERIA");
    });
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
