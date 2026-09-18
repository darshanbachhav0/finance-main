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
import { buildSirePreview, exportSireFile, hasAuthoritativeVoucherValidation, sireVoucherKey } from "../src/services/sireService.js";
import { generatedRoot } from "../src/services/storageService.js";

test("SIRE/RCE uses one validated fiscal voucher per row", { timeout: 120000 }, async (t) => {
  const database = `erp_sire_voucher_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  const generatedFiles = [];
  let sequence = 0;
  try {
    await Promise.all([AccountsPayable.init(), SunatVoucher.init(), GeneratedFile.init()]);
    const supplier = await Supplier.create({ identifierType: "RUC", rucDni: "20600000001", legalName: "Proveedor Fiscal UMA SAC", name: "Proveedor Fiscal UMA SAC", active: true });
    const user = { _id: new mongoose.Types.ObjectId() };

    async function request(period, flowType = "A1") {
      sequence += 1;
      const _id = new mongoose.Types.ObjectId();
      await FinancialRequest.collection.insertOne({
        _id,
        requestNumber: `SIRE-${period.replace("-", "")}-${String(sequence).padStart(3, "0")}`,
        accountingPeriod: period,
        flowType,
        supplier: supplier._id,
        supplierSnapshot: { identifier: supplier.rucDni, legalName: supplier.legalName },
        fiscalData: { fiscalPeriod: period, accountingDate: new Date(`${period}-20T12:00:00Z`) },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return FinancialRequest.findById(_id);
    }

    async function invoice({ request: financialRequest, number, currency = "PEN", rate = 1, valid = true, sourceBatch, voucherLink = true, flowType = financialRequest.flowType }) {
      const total = currency === "USD" ? 59 : 118;
      const net = currency === "USD" ? 50 : 100;
      const igv = total - net;
      const payable = await AccountsPayable.create({
        request: financialRequest._id,
        sourceBatch,
        flowType,
        supplier: supplier._id,
        supplierIdentifierSnapshot: supplier.rucDni,
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series: "F001", number, documentDate: new Date(`${financialRequest.accountingPeriod}-10T12:00:00Z`) },
        originalAmount: total,
        currency,
        exchangeRate: rate,
        penEquivalent: total * rate,
        outstandingAmount: total,
        status: "OPEN"
      });
      if (!voucherLink) return { payable, voucher: null };
      const voucher = await SunatVoucher.create({
        request: financialRequest._id,
        accountsPayable: payable._id,
        batch: sourceBatch,
        flowType,
        supplier: supplier._id,
        rucIssuer: supplier.rucDni,
        voucherType: "FACTURA",
        series: "F001",
        number,
        seriesNumber: `F001-${number}`,
        issueDate: new Date(`${financialRequest.accountingPeriod}-10T12:00:00Z`),
        currency,
        netAmount: net,
        igvAmount: igv,
        xmlAmount: total,
        validationStatus: "VALID",
        validationEvidence: valid
          ? { valid: true, taxpayer: { valid: true, source: "PADRON" }, fiscal: { valid: true, voucherVerified: true, source: "TEST" } }
          : { valid: true, taxpayer: { valid: true, source: "PADRON" }, fiscal: { valid: false, voucherVerified: false, source: "PADRON" } },
        validatedAt: new Date(),
        validatedBy: user._id
      });
      payable.sunatVoucher = voucher._id;
      await payable.save();
      return { payable, voucher };
    }

    await t.test("one request with one invoice creates one row", async () => {
      const item = await invoice({ request: await request("2026-01"), number: "000001" });
      const preview = await buildSirePreview("2026-01");
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.rows[0].voucherId, String(item.voucher._id));
      assert.equal(preview.rows[0].cxpReference, String(item.payable._id));
      assert.equal(preview.rows[0].supplierRuc, supplier.rucDni);
    });

    await t.test("one request with multiple A1 invoices creates one row per invoice", async () => {
      const parent = await request("2026-02", "A1");
      for (const number of ["000002", "000003", "000004"]) await invoice({ request: parent, number });
      const preview = await buildSirePreview("2026-02");
      assert.equal(preview.rows.length, 3);
      assert.equal(new Set(preview.rows.map((row) => row.requestReference)).size, 1);
      assert.equal(new Set(preview.rows.map((row) => row.voucherKey)).size, 3);
    });

    await t.test("A2 batch invoices remain separate voucher rows", async () => {
      const parent = await request("2026-03", "A2");
      const batch = new mongoose.Types.ObjectId();
      await invoice({ request: parent, number: "000005", sourceBatch: batch, flowType: "A2" });
      await invoice({ request: parent, number: "000006", sourceBatch: batch, flowType: "A2" });
      const preview = await buildSirePreview("2026-03");
      assert.equal(preview.rows.length, 2);
      assert.equal(preview.summary.eligible, 2);
    });

    await t.test("duplicate voucher links produce only one export row", async () => {
      const parent = await request("2026-04");
      const first = await invoice({ request: parent, number: "000007" });
      await AccountsPayable.create({
        request: parent._id,
        flowType: "A1",
        supplier: supplier._id,
        supplierIdentifierSnapshot: supplier.rucDni,
        sunatVoucher: first.voucher._id,
        originalAmount: 118,
        currency: "PEN",
        exchangeRate: 1,
        penEquivalent: 118,
        outstandingAmount: 118,
        status: "OPEN"
      });
      const preview = await buildSirePreview("2026-04");
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.validations.filter((record) => record.duplicate).length, 1);
    });

    await t.test("taxpayer-only evidence is excluded and historical missing links stay visible", async () => {
      const parent = await request("2026-05");
      await invoice({ request: parent, number: "000008", valid: false });
      await invoice({ request: parent, number: "000009", voucherLink: false });
      const preview = await buildSirePreview("2026-05");
      assert.equal(preview.rows.length, 0);
      assert.equal(preview.validations.length, 2);
      assert.ok(preview.validations.every((record) => record.manualReview));
      assert.ok(preview.validations.some((record) => record.row.fiscalValidationStatus === "MISSING_VOUCHER_LINK"));
    });

    await t.test("USD and Track B invoices retain exact CXP exchange rates", async () => {
      const parent = await request("2026-06", "B");
      await invoice({ request: parent, number: "000010", currency: "USD", rate: 3.812, flowType: "B" });
      const preview = await buildSirePreview("2026-06");
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.rows[0].currency, "USD");
      assert.equal(preview.rows[0].exchangeRate, 3.812);
    });

    await t.test("repeated exports contain each fiscal identity once and preserve both histories", async () => {
      const parent = await request("2026-07");
      await invoice({ request: parent, number: "000011" });
      const first = await exportSireFile({ period: "2026-07", user });
      const second = await exportSireFile({ period: "2026-07", user });
      generatedFiles.push(path.join(generatedRoot, "reports", first.history.fileName), path.join(generatedRoot, "reports", second.history.fileName));
      for (const result of [first, second]) {
        const lines = result.content.trim().split(/\r?\n/);
        assert.equal(lines.length, 2);
        assert.equal(result.history.rowCount, 1);
        assert.equal(result.history.metadata.voucherKeys.length, 1);
      }
      assert.equal(await GeneratedFile.countDocuments({ kind: "SIRE_CSV", period: "2026-07" }), 2);
      assert.equal((await buildSirePreview("2026-07")).rows[0].exportStatus, "EXPORTED");
    });

    assert.equal(sireVoucherKey({ supplierRuc: supplier.rucDni, documentType: "factura", series: "f001", number: "1" }), `${supplier.rucDni}|FACTURA|F001|1`);
    assert.equal(hasAuthoritativeVoucherValidation({ validationStatus: "VALID", validationEvidence: { valid: true, fiscal: { valid: true, voucherVerified: true } } }), true);
  } finally {
    await Promise.all(generatedFiles.map((file) => fs.rm(file, { force: true })));
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
