import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { installBbvaTestConfiguration, upcomingPaymentDate } from "./bbvaFixtures.js";
import AccountingPeriod from "../src/models/AccountingPeriod.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import CostCenter from "../src/models/CostCenter.js";
import ExpenseType from "../src/models/ExpenseType.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import PaymentBatch from "../src/models/PaymentBatch.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { ForeignTransferFileAdapter, foreignTransferReference } from "../src/integrations/banks/ForeignTransferFileAdapter.js";
import { supplierPaymentSnapshot } from "../src/services/paymentDestinationService.js";
import { readAsset } from "../src/services/durableAssetService.js";
import { generatePaymentBatch, previewPaymentBatch } from "../src/services/treasuryService.js";
import { AP_STATUS, EXPENSE_NATURE, FLOW_TYPE, REQUEST_STATUS, REQUEST_TYPE, ROLES } from "../src/utils/constants.js";

const req = { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } };
const abroadAccount = {
  scope: "FOREIGN", bank: "FOREIGN", bankOtherName: "Deutsche Bank", currency: "USD", accountType: "CURRENT", accountHolderName: "Laboratorios Ibéricos SL",
  accountNumber: "DE89370400440532013000", foreign: { swift: "DEUTDEFF", iban: "DE89370400440532013000", bankCountry: "Alemania", bankCity: "Fráncfort", bankAddress: "Taunusanlage 12" }
};

test("the transfers-abroad file follows the pilot layout and only takes accounts abroad in dollars", async () => {
  const adapter = new ForeignTransferFileAdapter();
  const item = { requestNumber: "REQ-2026-90007", supplierName: "Laboratorios Ibéricos SL", currency: "USD", amount: 1250.5, accountsPayable: { voucher: { series: "F001", number: "88" } }, request: { supplier: { fiscalAddress: "Calle Mayor 1, Madrid", country: "España" } }, bankAccount: abroadAccount };
  assert.equal(foreignTransferReference(item), "REQ-2026-90007 Factura F001-88");
  assert.throws(() => adapter.validateBatch([{ ...item, bankAccount: { ...abroadAccount, scope: "NATIONAL" } }]), /BBVA TXT/);
  assert.throws(() => adapter.validateBatch([{ ...item, currency: "PEN" }]), /dollars/);
  assert.throws(() => adapter.validateBatch([{ ...item, bankAccount: { ...abroadAccount, foreign: { ...abroadAccount.foreign, swift: "" } } }]), /SWIFT/);
  assert.equal(adapter.getFileName("LOTE-2026-0003"), "lote-2026-0003_transferencias_exterior.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await adapter.generateFile({ batchNumber: "LOTE-2026-0003", paymentDate: new Date("2026-11-16T17:00:00Z"), items: [item] }));
  const summary = workbook.getWorksheet("Resumen");
  assert.deepEqual(summary.getRow(3).values.slice(1), ["N.°", "Requerimiento", "Beneficiario", "País", "Banco", "SWIFT / ABA", "Cuenta / IBAN", "Moneda", "Importe", "Gastos", "Referencia"]);
  assert.deepEqual(summary.getRow(4).values.slice(1), [1, "REQ-2026-90007", "Laboratorios Ibéricos SL", "Alemania", "Deutsche Bank", "DEUTDEFF", "DE89370400440532013000", "USD", 1250.5, "SHA", "REQ-2026-90007 Factura F001-88"]);
  const payment = Object.fromEntries(workbook.getWorksheet("Pago 1").getSheetValues().filter(Boolean).map((row) => [row[1], row[2]]));
  assert.equal(payment["Cuenta del Beneficiario"], "DE89370400440532013000");
  assert.equal(payment["Moneda / Importe"], "USD 1250.50");
  assert.equal(payment.Gastos, "SHA");
  assert.equal(payment["Código Swift / ABA"], "DEUTDEFF");
  assert.equal(payment["Ciudad / País"], "Fráncfort / Alemania");
  assert.equal(payment["Dirección"], "Calle Mayor 1, Madrid");
});

test("a supplier paid abroad is never put in the BBVA TXT: Treasury generates its transfers-abroad file", { timeout: 120000 }, async (t) => {
  const databaseName = `erp_foreign_transfers_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await installBbvaTestConfiguration("USD");
    const treasury = await User.create({ name: "Tesoreria Uno", email: "tesoreria@test.local", passwordHash: "unused", role: ROLES.TREASURY, area: "Tesorería" });
    // The payment-cycle date (and so its period) depends on today's date.
    for (const period of new Set([new Date().toISOString().slice(0, 7), upcomingPaymentDate().slice(0, 7)])) {
      await AccountingPeriod.create({ period, status: "OPEN", openedBy: treasury._id, history: [{ action: "CREATED", by: treasury._id }] });
    }
    const supplier = await Supplier.create({ origin: "FOREIGN", country: "España", foreignTaxId: "B12345678", rucDni: "EXT-ESPANA-B12345678", legalName: "Laboratorios Ibéricos SL", fiscalAddress: "Calle Mayor 1, Madrid", supplierCode: "PRV-0950", homologationStatus: "HOMOLOGATED", status: "ACTIVE", active: true });
    const account = await SupplierBankAccount.create({ ...abroadAccount, supplier: supplier._id, verificationStatus: "VERIFIED", ownershipResult: "MATCH", active: true, validFrom: new Date() });
    assert.equal(supplierPaymentSnapshot(account).foreign.swift, "DEUTDEFF", "the payment snapshot keeps the SWIFT data");
    const center = await CostCenter.create({ code: "CC-EXT", name: "Laboratorios", area: "Salud", budgetMode: "ACTIVE", annualBudget: 100000, active: true });
    const expenseType = await ExpenseType.create({ code: "EXP-EXT", name: "Reactivos", category: "OPEX", accountingClass: "CLASS_6", accountNumber: "632101", deductible: true, permittedRequestTypes: [REQUEST_TYPE.OPEX], active: true });
    const { _id: request } = await FinancialRequest.create({
      requestNumber: "REQ-2026-90007", requestType: REQUEST_TYPE.OPEX, expenseNature: EXPENSE_NATURE.SERVICES, issueDate: "2026-10-20", accountingPeriod: "2026-10", currency: "USD",
      supplier: supplier._id, solicitor: treasury._id, requester: treasury._id, description: "Reactivos importados", status: REQUEST_STATUS.ACCOUNTED,
      lines: [{ costCenter: center._id, expenseType: expenseType._id, netAmount: 1250.5, igvAmount: 0, totalAmount: 1250.5 }]
    });
    const payable = await AccountsPayable.create({
      request, supplier: supplier._id, flowType: FLOW_TYPE.B, status: AP_STATUS.OPEN, currency: "USD", originalAmount: 1250.5, outstandingAmount: 1250.5, exchangeRate: 3.467, penEquivalent: 4335.48,
      provisionJournal: new mongoose.Types.ObjectId(), supplierIdentifierSnapshot: supplier.rucDni, voucher: { voucherType: "01", series: "F001", number: "88" },
      detraction: { status: "NOT_APPLICABLE", determinedAt: new Date(), confirmedAt: new Date() }, dueDate: new Date()
    });
    const ids = [String(payable._id)];

    await t.test("the BBVA TXT refuses it and says where it goes", async () => {
      const preview = await previewPaymentBatch({ payableIds: ids, currency: "USD" });
      assert.equal(preview.ready, false);
      assert.ok(preview.issues.some((issue) => issue.code === "FOREIGN_TRANSFER_REQUIRED"), JSON.stringify(preview.issues));
      await assert.rejects(() => generatePaymentBatch({ payableIds: ids, bank: "BBVA", currency: "USD", paymentDate: upcomingPaymentDate(), user: treasury, req }), /blocked payments/);
      assert.equal(await PaymentBatch.countDocuments(), 0);
    });

    await t.test("the transfers-abroad file takes it, and the payment then waits for verification and confirmation", async () => {
      const preview = await previewPaymentBatch({ payableIds: ids, currency: "USD", format: "FOREIGN_TRANSFER" });
      assert.equal(preview.ready, true, JSON.stringify(preview.issues));
      await assert.rejects(() => previewPaymentBatch({ payableIds: ids, currency: "PEN", format: "FOREIGN_TRANSFER" }).then((result) => { if (!result.ready) throw new Error(result.issues.map((issue) => issue.message).join(" ")); }), /dollars/);
      const { batch } = await generatePaymentBatch({ payableIds: ids, bank: "BBVA", currency: "USD", format: "FOREIGN_TRANSFER", paymentDate: upcomingPaymentDate(), user: treasury, req });
      assert.match(batch.fileName, /_transferencias_exterior\.xlsx$/);
      assert.equal(batch.adapterMode, "SWIFT_EXCEL");
      assert.equal(batch.verification.status, "PENDING", "GAF verifies it before Treasury downloads it, like a TXT");
      assert.equal(batch.items[0].bankAccount.scope, "FOREIGN");
      assert.equal(batch.items[0].bankAccount.foreign.swift, "DEUTDEFF");
      const stored = await AccountsPayable.findById(payable._id).lean();
      assert.equal(stored.status, AP_STATUS.PAYMENT_FILE_CREATED);
      assert.equal(stored.bankAccountSnapshot.foreign.iban, "DE89370400440532013000");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await readAsset(batch.filePath));
      assert.equal(workbook.getWorksheet("Resumen").getRow(4).getCell(2).value, "REQ-2026-90007");
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
