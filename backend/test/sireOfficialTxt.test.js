import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import GeneratedFile from "../src/models/GeneratedFile.js";
import Supplier from "../src/models/Supplier.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import {
  RCE_STRUCTURE,
  buildSirePreview,
  exportSireFile,
  formatSireAmount,
  formatSireDate,
  identityDocumentCode,
  isValidRuc,
  rceDocumentTypeCode,
  rceFileName,
  sanitizeSireText
} from "../src/services/sireService.js";
import { generatedRoot } from "../src/services/storageService.js";

const UMA_RUC = "20100000009";
const SUPPLIER_RUC = "20600000005";
const OTHER_SUPPLIER_RUC = "20600000013";

test("SIRE RCE official TXT helpers follow Anexo 11 / Tabla 13 rules", () => {
  assert.equal(rceFileName({ ruc: UMA_RUC, period: "2026-08" }), `LE${UMA_RUC}20260800080400021112.TXT`);
  assert.equal(rceFileName({ ruc: UMA_RUC, period: "2026-08", hasInformation: false, bookCurrency: "USD" }), `LE${UMA_RUC}20260800080400021022.TXT`);
  // Tabla 13.1 positions 01-33 plus the ".TXT" extension.
  assert.equal(rceFileName({ ruc: UMA_RUC, period: "2026-08" }).length, 33 + 4);

  assert.equal(isValidRuc("20131312955"), true); // SUNAT's own RUC
  assert.equal(isValidRuc(SUPPLIER_RUC), true);
  assert.equal(isValidRuc("20600000001"), false);
  assert.equal(isValidRuc("2060000000"), false);
  assert.equal(isValidRuc("30600000005"), false);

  assert.equal(formatSireAmount(1234567.5), "1234567.50");
  assert.equal(formatSireAmount(-118), "-118.00");
  assert.equal(formatSireAmount(-0), "0.00");
  assert.equal(formatSireAmount(0.005), "0.01");
  assert.equal(formatSireDate(new Date("2026-08-05T12:00:00Z")), "05/08/2026");
  assert.equal(formatSireDate(null), "");

  assert.equal(rceDocumentTypeCode("FACTURA"), "01");
  assert.equal(rceDocumentTypeCode("nota de credito"), "07");
  assert.equal(rceDocumentTypeCode("NOTA_DEBITO"), "08");
  assert.equal(rceDocumentTypeCode("RECIBO_HONORARIOS"), "02");
  assert.equal(rceDocumentTypeCode("1"), "01");
  assert.equal(rceDocumentTypeCode("RECIBO_INTERNO"), "");

  assert.equal(identityDocumentCode(SUPPLIER_RUC, "RUC"), "6");
  assert.equal(identityDocumentCode("45678901", "DNI"), "1");
  assert.equal(identityDocumentCode("45678901"), "1");

  assert.equal(sanitizeSireText("ACME | Hnos / Cia \\ SAC"), "ACME Hnos Cia SAC");
  assert.equal(RCE_STRUCTURE.fieldCount, 37);
});

test("SIRE RCE official TXT export", { timeout: 120000 }, async (t) => {
  const database = `erp_sire_txt_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  const cleanup = [];
  const previousEnv = Object.fromEntries(["SIRE_TAXPAYER_RUC", "SIRE_TAXPAYER_NAME", "SIRE_RCE_IGV_DESTINATION", "SIRE_RCE_BOOK_CURRENCY"].map((key) => [key, process.env[key]]));
  process.env.SIRE_TAXPAYER_RUC = UMA_RUC;
  process.env.SIRE_TAXPAYER_NAME = "UNIVERSIDAD MARIA AUXILIADORA";
  delete process.env.SIRE_RCE_IGV_DESTINATION;
  delete process.env.SIRE_RCE_BOOK_CURRENCY;
  let sequence = 0;
  try {
    await Promise.all([AccountsPayable.init(), SunatVoucher.init(), GeneratedFile.init()]);
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: SUPPLIER_RUC, legalName: "Proveedor Oficial | SAC", name: "Proveedor Oficial SAC", active: true });
    const user = { _id: new mongoose.Types.ObjectId() };

    async function request(period) {
      sequence += 1;
      const _id = new mongoose.Types.ObjectId();
      await FinancialRequest.collection.insertOne({
        _id,
        requestNumber: `TXT-${period.replace("-", "")}-${String(sequence).padStart(3, "0")}`,
        accountingPeriod: period,
        flowType: "A1",
        supplier: supplier._id,
        supplierSnapshot: { identifier: supplier.rucDni, legalName: supplier.legalName },
        fiscalData: { fiscalPeriod: period, accountingDate: new Date(`${period}-20T12:00:00Z`) },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return FinancialRequest.findById(_id);
    }

    async function voucher({
      period, type = "FACTURA", series = "F001", number, net = 100, igv = 18, total = 118, currency = "PEN", rate = 1,
      status = "OPEN", issueDate = `${period}-10T12:00:00Z`, rucIssuer = SUPPLIER_RUC, evidenceExtra = {}
    }) {
      const parent = await request(period);
      const payable = await AccountsPayable.create({
        request: parent._id,
        flowType: "A1",
        supplier: supplier._id,
        supplierIdentifierSnapshot: rucIssuer,
        voucher: { voucherType: type, documentType: type, series, number, documentDate: new Date(issueDate) },
        originalAmount: total,
        currency,
        exchangeRate: rate,
        penEquivalent: total * rate,
        outstandingAmount: total,
        status
      });
      const created = await SunatVoucher.create({
        request: parent._id,
        accountsPayable: payable._id,
        flowType: "A1",
        supplier: supplier._id,
        rucIssuer,
        voucherType: type,
        series,
        number,
        seriesNumber: `${series}-${number}`,
        issueDate: new Date(issueDate),
        currency,
        netAmount: net,
        igvAmount: igv,
        xmlAmount: total,
        validationStatus: "VALID",
        validationEvidence: { valid: true, taxpayer: { valid: true, source: "PADRON" }, fiscal: { valid: true, voucherVerified: true, source: "TEST" }, ...evidenceExtra },
        validatedAt: new Date(),
        validatedBy: user._id
      });
      payable.sunatVoucher = created._id;
      await payable.save();
      return { payable, voucher: created };
    }

    await t.test("a PEN factura produces the exact 37-field Anexo 11 line", async () => {
      await voucher({ period: "2026-01", number: "00000123" });
      const preview = await buildSirePreview("2026-01");
      assert.equal(preview.summary.readyToExport, true);
      assert.equal(preview.summary.fileName, `LE${UMA_RUC}20260100080400021112.TXT`);
      assert.equal(preview.summary.structureVersion, "RCE_ANEXO11_RS040_2022");
      const [record] = preview.validations;
      assert.equal(record.fields.length, 37);
      assert.equal(
        record.line,
        [
          UMA_RUC, "UNIVERSIDAD MARIA AUXILIADORA", "202601", "", "10/01/2026", "", "01", "F001", "", "123", "",
          "6", SUPPLIER_RUC, "Proveedor Oficial SAC",
          "100.00", "18.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "118.00",
          "PEN", "", "", "", "", "", "", "", "", "", "", ""
        ].join("|")
      );
    });

    await t.test("export writes the TXT with the official name, CRLF endings and no header", async () => {
      const result = await exportSireFile({ period: "2026-01", user });
      cleanup.push(path.dirname(path.join(generatedRoot, result.history.url.replace(/^\/generated\//, ""))));
      assert.equal(result.fileName, `LE${UMA_RUC}20260100080400021112.TXT`);
      assert.equal(result.history.fileName, result.fileName);
      assert.equal(result.history.metadata.format, "SUNAT_RCE_TXT");
      assert.ok(result.content.endsWith("\r\n"));
      const lines = result.content.split("\r\n").filter(Boolean);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].split("|").length, 37);
      assert.ok(lines[0].startsWith(`${UMA_RUC}|UNIVERSIDAD MARIA AUXILIADORA|202601|`));
      const stored = await fs.readFile(path.join(generatedRoot, result.history.url.replace(/^\/generated\//, "")), "utf8");
      assert.equal(stored, result.content);
    });

    await t.test("USD vouchers carry currency and #.### exchange rate", async () => {
      await voucher({ period: "2026-02", number: "55", net: 50, igv: 9, total: 59, currency: "USD", rate: 3.7125 });
      const preview = await buildSirePreview("2026-02");
      const fields = preview.validations[0].fields;
      assert.equal(fields[24], "59.00");
      assert.equal(fields[25], "USD");
      assert.equal(fields[26], "3.713");
      assert.ok(preview.validations[0].warnings.some((message) => message.includes("rounded")));
    });

    await t.test("cancelled payables are excluded and reported, without blocking the export", async () => {
      await voucher({ period: "2026-03", number: "301" });
      await voucher({ period: "2026-03", number: "302", status: "CANCELLED" });
      const preview = await buildSirePreview("2026-03");
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.summary.cancelledExcluded, 1);
      assert.equal(preview.summary.blockingErrors, 0);
      assert.equal(preview.summary.readyToExport, true);
      const cancelled = preview.validations.find((record) => record.excludedReason === "CANCELLED");
      assert.equal(cancelled.row.number, "302");
      assert.equal(cancelled.line, undefined);
      const result = await exportSireFile({ period: "2026-03", user });
      cleanup.push(path.dirname(path.join(generatedRoot, result.history.url.replace(/^\/generated\//, ""))));
      assert.ok(!result.content.includes("|302|"));
      assert.ok(result.content.includes("|301|"));
    });

    await t.test("credit notes are negative and reference the original document (fields 28-32)", async () => {
      const original = await voucher({ period: "2026-04", number: "401" });
      // Linked through a reference to the original SunatVoucher, stored outside the current schema.
      const byLink = await voucher({ period: "2026-04", type: "NOTA_CREDITO", series: "FC01", number: "9", net: 50, igv: 9, total: 59 });
      await SunatVoucher.collection.updateOne({ _id: byLink.voucher._id }, { $set: { referenceVoucher: original.voucher._id } });
      // Reference kept as a plain document description.
      await voucher({
        period: "2026-04", type: "NOTA_CREDITO", series: "FC01", number: "10", net: 10, igv: 1.8, total: 11.8,
        evidenceExtra: { referenceDocument: { documentType: "FACTURA", series: "F002", number: "000777", issueDate: "2026-03-15T12:00:00Z" } }
      });
      const preview = await buildSirePreview("2026-04");
      assert.equal(preview.summary.blockingErrors, 0, JSON.stringify(preview.validations.map((record) => record.errors)));
      const linked = preview.validations.find((record) => record.row.number === "9").fields;
      assert.equal(linked[6], "07");
      assert.deepEqual(linked.slice(14, 16), ["-50.00", "-9.00"]);
      assert.equal(linked[24], "-59.00");
      assert.deepEqual(linked.slice(27, 32), ["10/04/2026", "01", "F001", "", "401"]);
      const described = preview.validations.find((record) => record.row.number === "10").fields;
      assert.deepEqual(described.slice(27, 32), ["15/03/2026", "01", "F002", "", "777"]);
      assert.equal(described[24], "-11.80");
    });

    await t.test("validation errors are listed per row and block the file", async () => {
      await voucher({ period: "2026-05", number: "501" });
      await voucher({ period: "2026-05", type: "NOTA_CREDITO", series: "FC01", number: "502", net: 10, igv: 1.8, total: 11.8 });
      await voucher({ period: "2026-05", number: "503", rucIssuer: "20600000001" });
      await voucher({ period: "2026-05", number: "504", net: 100, igv: 18, total: 120 });
      await voucher({ period: "2026-05", number: "505", issueDate: "2026-06-02T12:00:00Z" });
      await voucher({ period: "2026-05", type: "RECIBO_INTERNO", series: "R001", number: "506" });
      const preview = await buildSirePreview("2026-05");
      const errorsFor = (number) => preview.validations.find((record) => record.row.number === number).errors.join(" ");
      assert.equal(preview.validations.find((record) => record.row.number === "501").eligible, true);
      assert.match(errorsFor("502"), /does not reference the document it modifies/);
      assert.match(errorsFor("503"), /not a valid RUC/);
      assert.match(errorsFor("504"), /Amounts do not add up/);
      assert.match(errorsFor("505"), /later than the RCE period/);
      assert.match(errorsFor("506"), /no SUNAT Tabla 10\/11 code/);
      assert.equal(preview.summary.blockingErrors, 5);
      assert.equal(preview.summary.readyToExport, false);
      await assert.rejects(exportSireFile({ period: "2026-05", user }), (error) => {
        assert.equal(error.statusCode ?? error.status, 422);
        assert.equal(error.details.failures.length, 5);
        assert.ok(error.details.failures.every((failure) => failure.errors.length > 0));
        return true;
      });
      assert.equal(await GeneratedFile.countDocuments({ period: "2026-05" }), 0);
    });

    await t.test("IGV destination DNG moves base and IGV to fields 19/20", async () => {
      process.env.SIRE_RCE_IGV_DESTINATION = "DNG";
      try {
        await voucher({ period: "2026-06", number: "601" });
        const fields = (await buildSirePreview("2026-06")).validations[0].fields;
        assert.deepEqual(fields.slice(14, 20), ["0.00", "0.00", "0.00", "0.00", "100.00", "18.00"]);
      } finally {
        delete process.env.SIRE_RCE_IGV_DESTINATION;
      }
    });

    await t.test("exempt vouchers go to field 21 (no gravadas)", async () => {
      await voucher({ period: "2026-07", number: "701", net: 250, igv: 0, total: 250 });
      const fields = (await buildSirePreview("2026-07")).validations[0].fields;
      assert.deepEqual(fields.slice(14, 21), ["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "250.00"]);
    });

    await t.test("missing taxpayer configuration blocks the export", async () => {
      await voucher({ period: "2026-09", number: "901" });
      delete process.env.SIRE_TAXPAYER_RUC;
      try {
        const preview = await buildSirePreview("2026-09");
        assert.ok(preview.summary.configurationErrors.some((message) => message.includes("SIRE_TAXPAYER_RUC")));
        assert.equal(preview.summary.readyToExport, false);
        await assert.rejects(exportSireFile({ period: "2026-09", user }), /configuration is incomplete/);
      } finally {
        process.env.SIRE_TAXPAYER_RUC = UMA_RUC;
      }
      process.env.SIRE_TAXPAYER_RUC = "20600000001";
      try {
        const preview = await buildSirePreview("2026-09");
        assert.ok(preview.summary.configurationErrors.some((message) => message.includes("not a valid RUC")));
      } finally {
        process.env.SIRE_TAXPAYER_RUC = UMA_RUC;
      }
    });

    assert.equal(isValidRuc(OTHER_SUPPLIER_RUC), true);
  } finally {
    await Promise.all(cleanup.map((directory) => fs.rm(directory, { force: true, recursive: true })));
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
