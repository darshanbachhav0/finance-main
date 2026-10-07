import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import { applyContractEmailImport, createContractEmailImportPlan, readContractsWorkbook } from "../src/services/contractEmailImportService.js";

// A workbook shaped like the HR contracts master: a grouping row, then the header row.
async function writeWorkbook(file, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Maestro");
  sheet.addRow(["IDENTIFICACIÓN", "", "", "", "PUESTO Y CENTRO DE COSTOS", "CONTRATO", "CONTACTO"]);
  sheet.addRow(["COD", "N° DOCUMENTO", "TIPO DOC", "APELLIDOS Y NOMBRES", "ÁREA", "ESTADO", "CORREO INSTITUCIONAL"]);
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(file);
}

test("contracts-master import: each person's institutional email is set by DNI; unsafe rows are reported", { timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "uma-contract-emails-"));
  const file = path.join(directory, "MAESTRO_CONTRATOS_TEST.xlsx");
  const database = `erp_contract_email_import_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  try {
    await User.init();
    const ana = await User.create({ dni: "12345678", name: "TORRES DIAZ ANA", passwordHash: "unused" });
    const julio = await User.create({ dni: "9874299", name: "VILLAR JULIO", email: "julio.old@uma.edu.pe", passwordHash: "unused" });
    const same = await User.create({ dni: "22222222", name: "SAME PERSON", email: "same@uma.edu.pe", passwordHash: "unused" });
    await User.create({ dni: "33333333", name: "HOLDER", email: "taken@uma.edu.pe", passwordHash: "unused" });
    const wantsTaken = await User.create({ dni: "44444444", name: "WANTS TAKEN", passwordHash: "unused" });
    const ceased = await User.create({ dni: "55555555", name: "CEASED", passwordHash: "unused" });
    await writeWorkbook(file, [
      [1, 12345678, "DNI", "TORRES DIAZ ANA", "TESORERIA", "ACTIVO", "Ana.Torres@UMA.edu.pe "],
      [2, "09874299", "DNI", "VILLAR BARNUEVO JULIO CESAR", "CONTABILIDAD", "ACTIVO", "julio.villar@uma.edu.pe"],
      [3, "22222222", "DNI", "SAME PERSON", "RRHH", "ACTIVO", "same@uma.edu.pe"],
      [4, "44444444", "DNI", "WANTS TAKEN", "RRHH", "ACTIVO", "taken@uma.edu.pe"],
      [5, "55555555", "DNI", "CEASED", "RRHH", "CESADO", "ceased@uma.edu.pe"],
      [6, "66666666", "DNI", "PROGRAM IN EMAIL", "DOCENCIA", "ACTIVO", "enfermería"],
      [7, "77777777", "DNI", "PERSONAL ADDRESS", "DOCENCIA", "ACTIVO", "someone@gmail.com"],
      [8, "88888888", "DNI", "NOT A USER", "DOCENCIA", "ACTIVO", "nobody@uma.edu.pe"],
      [9, "10101010", "DNI", "SHARED ONE", "DOCENCIA", "ACTIVO", "shared@uma.edu.pe"],
      [10, "20202020", "DNI", "SHARED TWO", "DOCENCIA", "ACTIVO", "shared@uma.edu.pe"],
      [11, "30303030", "DNI", "NO EMAIL", "DOCENCIA", "CESA EN EL PERIODO", ""]
    ]);
    const workbook = await readContractsWorkbook(file);
    const plan = async (options = {}) => createContractEmailImportPlan({ ...workbook, users: await User.find({}).lean(), ...options });

    let first;
    await t.test("the header row is found and rows are read with their document and email", async () => {
      assert.equal(workbook.sheetName, "Maestro");
      assert.equal(workbook.rows.length, 11);
      assert.equal(workbook.rows[0].sourceRow, 3);
      assert.equal(workbook.rows[0].documentNumber, "12345678");
      first = await plan();
    });

    await t.test("only safe matches are planned; every other row is reported with its reason", () => {
      assert.deepEqual(first.updates.map((item) => [item.document, item.email]).sort(), [["09874299", "julio.villar@uma.edu.pe"], ["12345678", "ana.torres@uma.edu.pe"]]);
      assert.equal(first.updates.find((item) => item.document === "09874299").previousEmail, "julio.old@uma.edu.pe");
      assert.equal(first.unchanged, 1, "SAME PERSON already has this address");
      const v = first.validation;
      assert.deepEqual(v.ceasedEmployees.map((item) => item.document), ["55555555"]);
      assert.deepEqual(v.invalidEmails.map((item) => item.value), ["enfermería"]);
      assert.deepEqual(v.otherDomainEmails.map((item) => item.email), ["someone@gmail.com"]);
      assert.deepEqual(v.unmatchedEmployees.map((item) => item.document), ["88888888"]);
      assert.deepEqual(v.duplicateEmails.map((item) => item.email), ["shared@uma.edu.pe"]);
      assert.deepEqual(v.emailsUsedByOtherUsers.map((item) => item.document), ["44444444"]);
      assert.deepEqual(v.missingEmails.map((item) => item.document), ["30303030"]);
      assert.deepEqual(v.nameDifferences.map((item) => item.document), ["09874299"]);
    });

    await t.test("other domains are accepted only when allowed", async () => {
      const open = await plan({ allowedDomains: [] });
      assert.equal(open.validation.otherDomainEmails.length, 0);
      assert.equal(open.validation.unmatchedEmployees.some((item) => item.document === "77777777"), true);
    });

    await t.test("applying sets the addresses, records their source and audits each change", async () => {
      const result = await applyContractEmailImport(first, new Date("2026-10-07T12:00:00Z"));
      assert.deepEqual({ set: result.emailsSet, replaced: result.emailsReplaced, failed: result.failed.length }, { set: 1, replaced: 1, failed: 0 });
      const savedAna = await User.findById(ana._id);
      assert.equal(savedAna.email, "ana.torres@uma.edu.pe");
      assert.equal(savedAna.emailImport.source, "MAESTRO_CONTRATOS_TEST.xlsx");
      assert.equal(savedAna.emailImport.sourceRow, 3);
      assert.equal(savedAna.emailNotifications, true, "email notifications are on by default");
      assert.equal((await User.findById(julio._id)).email, "julio.villar@uma.edu.pe");
      for (const untouched of [same, wantsTaken, ceased]) assert.equal((await User.findById(untouched._id)).email, untouched.email);
      const audits = await AuditLog.find({ action: "EMAIL_IMPORTED" }).lean();
      assert.equal(audits.length, 2);
      assert.deepEqual(audits.find((item) => String(item.entityId) === String(julio._id)).oldValues, { email: "julio.old@uma.edu.pe" });
      const again = await plan();
      assert.equal(again.updates.length, 0, "a second run changes nothing");
      assert.equal(again.unchanged, 3);
    });
  } finally {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
