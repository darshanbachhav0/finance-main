import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import BudgetException from "../src/models/BudgetException.js";
import BudgetCommitment from "../src/models/BudgetCommitment.js";
import BudgetRule from "../src/models/BudgetRule.js";
import CostCenter from "../src/models/CostCenter.js";
import User from "../src/models/User.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import { reserveBudget, releaseBudget, assertBudgetBeforePosting, assertRenditionBudgetAvailable, executeDeferredBudget } from "../src/services/budgetService.js";
import { recordBudgetExceptionDecision } from "../src/services/budgetExceptionService.js";
import { resolveExchangeRateSnapshot, applyExchangeRate } from "../src/services/exchangeRateService.js";
import { rateSnapshot, fetchSunatSellingRate } from "../src/services/sunatExchangeRateProvider.js";
import { assertVoucherXmlMatches, parseInvoiceXml } from "../src/services/xmlValidationService.js";
import { validateVoucherWithSunat, createSunatVoucher, findDuplicateVoucher } from "../src/services/sunatVoucherService.js";
import { PublicPadronSunatProvider } from "../src/integrations/sunat/PublicPadronSunatProvider.js";
import { ProductionSunatProvider } from "../src/integrations/sunat/ProductionSunatProvider.js";
import { sunatService } from "../src/services/sunatService.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import { invoiceXml } from "./fiscalFixtures.js";
import { tempUploadDir } from "../src/services/storageService.js";

test("PEN, authoritative USD, dated fallback and immutable historical exchange evidence", async t => {
  const unavailable = async () => { throw new Error("unavailable"); };
  const official = date => ({ rate: 3.75, date, source: "SUNAT", providerMode: "SUNAT", authoritative: true });
  await t.test("PEN requires no provider or conversion", async () => {
    const result = await resolveExchangeRateSnapshot("PEN", "2026-09-14", { lookup: unavailable, fetchRate: unavailable });
    assert.equal(result.rate, 1); assert.equal(result.fallback.used, false);
  });
  await t.test("USD uses official selling rate and exact evidence", async () => {
    const result = await resolveExchangeRateSnapshot("USD", "2026-09-14", { lookup: async () => null, fetchRate: async date => official(date) });
    assert.equal(result.rate, 3.75); assert.equal(result.authoritative, true); assert.equal(result.fallback.used, false);
  });
  for (const [name, date, published] of [["weekend", "2026-09-13", "2026-09-11"], ["holiday / missing publication", "2026-09-14", "2026-09-11"]]) {
    await t.test(name + " uses previous published business day", async () => {
      const result = await resolveExchangeRateSnapshot("USD", date, { fetchRate: unavailable, lookup: async day => day.toISOString().slice(0, 10) === published ? official(published) : null });
      assert.equal(result.date.toISOString().slice(0, 10), published);
      assert.equal(result.fallback.used, true); assert.equal(result.fallback.requestedDate, date); assert.equal(result.fallback.source, "SUNAT");
    });
  }
  await t.test("BCRP reference is opt-in and never authoritative; stale or future rates fail", async () => {
    const options = { lookup: async day => ({ rate: 3.7, date: day, source: "BCRP", providerMode: "BCRP_FALLBACK", authoritative: true }), fetchRate: unavailable };
    await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-09-14", { ...options, allowReference: false }), e => e.code === "EXCHANGE_RATE_MISSING");
    const fallback = await resolveExchangeRateSnapshot("USD", "2026-09-14", { ...options, allowReference: true });
    assert.equal(fallback.authoritative, false); assert.equal(fallback.fallback.used, true);
    assert.throws(() => rateSnapshot(official("2026-09-15"), "2026-09-14"));
    assert.equal(rateSnapshot({ ...official("2026-09-14"), source: "BCRP" }, "2026-09-14").authoritative, false);
    await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-09-14", { lookup: async () => null, fetchRate: async () => official("2026-08-01"), allowReference: false }));
    await assert.rejects(() => fetchSunatSellingRate("2026-09-14", { provider: { getSellingExchangeRate: async () => ({ ...official("2026-09-14"), source: "BCRP" }) } }));
  });
  await t.test("existing manual/BCRP snapshots are not rewritten", async () => {
    for (const source of ["MANUAL", "BCRP_FALLBACK"]) {
      const historical = { status: "CONTABILIZADO", currency: "USD", exchangeRate: 3.2, exchangeRateDate: new Date("2021-01-04"), exchangeRateSource: source, lines: [] };
      const before = JSON.stringify(historical); await applyExchangeRate(historical); assert.equal(JSON.stringify(historical), before);
    }
  });
});

test("budget commitment, exceptions, separation of duties and cancellation history", async t => {
  const database = `erp_budget_fiscal_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
  try {
    await Promise.all([BudgetCommitment.init(), BudgetException.init()]);
    const budget = await User.create({ name: "Budget", email: "budget@fiscal.test", role: "Budget", passwordHash: "unused" });
    const management = await User.create({ name: "Management", email: "management@fiscal.test", role: "Management", passwordHash: "unused" });
    const center = await CostCenter.create({ code: "FISCAL-CC", name: "Fiscal", area: "Finance", annualBudget: 200, budgetMode: "TRANSITIONAL", active: true });
    const make = amount => ({ _id: new mongoose.Types.ObjectId(), requestNumber: `R-${new mongoose.Types.ObjectId()}`, accountingPeriod: "2026-09", issueDate: "2026-09-14", lines: [{ costCenter: center._id, expenseType: new mongoose.Types.ObjectId(), totalAmount: amount }] });
    const request = make(100);
    await t.test("sufficient budget reserves and reduces availability, including legacy transitional configuration", async () => {
      const commitment = await reserveBudget(request, budget._id);
      assert.equal(commitment.status, "COMMITTED");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 100);
      await assertBudgetBeforePosting(request, { amount: 100 });
      await assert.rejects(() => assertBudgetBeforePosting(make(100)), /commitment/);
      await assert.rejects(() => assertBudgetBeforePosting(request, { amount: 101 }), /remaining/);
    });
    await t.test("insufficiency always creates an auditable exception, even default REJECT configuration", async () => {
      const shortage = make(150);
      await assert.rejects(() => reserveBudget(shortage, budget._id), e => e.code === "INSUFFICIENT_BUDGET");
      const exception = await BudgetException.findOne({ request: shortage._id });
      assert.ok(exception); assert.equal(exception.history[0].action, "CREATED");
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "No", budget, {}), e => e.statusCode === 403);
      await recordBudgetExceptionDecision(exception._id, "REVIEWED", "Recommend funding", budget, {});
      await recordBudgetExceptionDecision(exception._id, "APPROVED", "Increase required", management, {});
      await assert.rejects(() => reserveBudget(shortage, budget._id), e => e.code === "INSUFFICIENT_BUDGET");
      assert.equal((await BudgetException.findById(exception._id)).history.length, 3);
    });
    await t.test("extraordinary management approval enables overrun; self approval and repeated decisions are blocked", async () => {
      await BudgetRule.create({ code: "FISCAL-EX", name: "Extraordinary", costCenter: center._id, mode: "ACTIVE", exceptionStrategy: "EXTRAORDINARY_APPROVAL", active: true });
      const shortage = make(150);
      await assert.rejects(() => reserveBudget(shortage, budget._id));
      const exception = await BudgetException.findOne({ request: shortage._id });
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Self", { _id: budget._id, role: "Management" }, {}), e => e.statusCode === 403);
      await FinancialRequest.collection.insertOne({ _id: shortage._id, requester: management._id });
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "APPROVED", "Own request", management, {}), e => e.statusCode === 403);
      await FinancialRequest.collection.updateOne({ _id: shortage._id }, { $unset: { requester: "" } });
      await recordBudgetExceptionDecision(exception._id, "APPROVED", "Authorized overrun", management, {});
      await reserveBudget(shortage, budget._id);
      await assert.rejects(() => recordBudgetExceptionDecision(exception._id, "REJECTED", "Again", management, {}));
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 250);
      await releaseBudget(shortage, budget._id, "Cancelled before posting");
    });
    await t.test("cancellation releases once and preserves all commitment movements", async () => {
      await releaseBudget(request, budget._id, "Cancelled before posting");
      await releaseBudget(request, budget._id, "Retry");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 0);
      const commitment = await BudgetCommitment.findOne({ request: request._id });
      assert.equal(commitment.history.length, 2); assert.equal(commitment.history[1].status, "RELEASED");
      await assert.rejects(() => assertBudgetBeforePosting(request));
    });
    await t.test("Track C reserves before advance accounting and executes only actual eligible rendition expense", async () => {
      const advance = { ...make(80), flowType: "C" };
      await reserveBudget(advance, budget._id);
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 80);
      assert.equal((await CostCenter.findById(center._id)).executedAmount, 0);
      const actual = [{ ...advance.lines[0], totalAmount: 60 }];
      await assertRenditionBudgetAvailable(advance, budget._id, actual);
      await executeDeferredBudget(advance, budget._id, { lines: actual });
      const commitment = await BudgetCommitment.findOne({ request: advance._id });
      assert.equal(commitment.executedAmount, 60); assert.equal(commitment.paidAmount, 60);
      assert.equal(commitment.renditionReservationSnapshot.totalAmount, 80);
      assert.equal(commitment.history.find(event => event.status === "RELEASED").amount, 20);
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 0);
      assert.equal((await CostCenter.findById(center._id)).executedAmount, 60);
    });
    await t.test("USD invoice rate variance reserves additional funds and preserves original evidence", async () => {
      const usd = { ...make(30), currency: "USD" };
      await reserveBudget(usd, budget._id);
      const evidence = { rate: 3.8, source: "SUNAT", authoritative: true, rateDate: "2026-09-14" };
      const adjusted = await assertBudgetBeforePosting(usd, { amount: 40, userId: budget._id, allowFxTopUp: true, exchangeRateEvidence: evidence });
      assert.equal(adjusted.totalAmount, 40);
      assert.equal(adjusted.adjustments[0].previousTotal, 30);
      assert.equal(adjusted.adjustments[0].amount, 10);
      assert.equal(adjusted.adjustments[0].exchangeRateEvidence.source, "SUNAT");
      assert.equal(adjusted.history[0].amount, 30);
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 40);
      await assert.rejects(() => assertBudgetBeforePosting(usd, { amount: 200, userId: budget._id, allowFxTopUp: true, exchangeRateEvidence: evidence }), e => e.code === "INSUFFICIENT_BUDGET");
      assert.ok(await BudgetException.findOne({ request: usd._id }));
      assert.equal((await BudgetCommitment.findOne({ request: usd._id })).totalAmount, 40);
      await releaseBudget(usd, budget._id, "Cancelled");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 0);
    });
    await t.test("duplicate fiscal identity is protected by the database index", async () => {
      await SunatVoucher.init();
      const voucher = { ruc: "20999999991", voucherType: "FACTURA", series: "F001", number: "0001", totalAmount: 118 };
      const args = { request: { _id: request._id, flowType: "A1", currency: "PEN" }, supplier: new mongoose.Types.ObjectId(), voucher, validationStatus: "PENDING", user: budget };
      await createSunatVoucher(args); assert.ok(await findDuplicateVoucher(voucher));
      await assert.rejects(() => createSunatVoucher(args), e => e.code === 11000);
    });
    await t.test("unposted legacy unreserved commitments are revalidated without losing original evidence", async () => {
      const legacy = make(20);
      const original = await BudgetCommitment.create({ request: legacy._id, requestNumber: legacy.requestNumber, period: legacy.accountingPeriod, totalAmount: 20, status: "NO_BUDGET", lines: legacy.lines.map(line => ({ ...line, amount: 20, mode: "TRANSITIONAL" })), createdBy: budget._id, history: [{ status: "NO_BUDGET", amount: 20, by: budget._id }] });
      const updated = await assertBudgetBeforePosting(legacy, { userId: budget._id, amount: 20 });
      assert.equal(String(updated._id), String(original._id));
      assert.equal(updated.history[0].status, "NO_BUDGET"); assert.equal(updated.history[1].status, "COMMITTED");
      assert.equal(updated.legacyUnreservedSnapshot.lines[0].mode, "TRANSITIONAL");
      assert.equal((await CostCenter.findById(center._id)).committedAmount, 20);
    });
  } finally { if (mongoose.connection.name === database) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
});

test("supplier status is not invoice validity; XML evidence blocks inconsistent inputs", async t => {
  const originalTaxpayer = sunatService.validateTaxpayer, originalVoucher = sunatService.validateVoucher;
  const filePath = path.join(tempUploadDir, `fiscal-xml-${process.pid}.xml`);
  const voucher = { ruc: "20999999991", series: "F001", number: "0001", issueDate: "2026-09-14", currency: "PEN", netAmount: 100, igvAmount: 18, totalAmount: 118 };
  await fs.mkdir(tempUploadDir, { recursive: true }); await fs.writeFile(filePath, invoiceXml(voucher));
  try {
    await t.test("public Padrón never verifies individual invoices", async () => {
      const provider = new PublicPadronSunatProvider(); provider.validateTaxpayer = async () => ({ valid: true, status: "ACTIVO", condition: "HABIDO" });
      const result = await provider.validateVoucher(voucher); assert.equal(result.valid, false); assert.equal(result.voucherVerified, false);
      sunatService.validateTaxpayer = provider.validateTaxpayer;
      sunatService.validateVoucher = async () => ({ ...result, valid: true });
      const checked = await validateVoucherWithSunat(voucher); assert.equal(checked.valid, false); assert.equal(checked.taxpayer.valid, true);
    });
    await t.test("individual and batch invoice inputs compare all seven XML fields", async () => {
      assert.equal((await parseInvoiceXml(filePath)).invoiceNumber, "F001-0001");
      assert.equal((await assertVoucherXmlMatches(filePath, voucher)).validated, true);
      for (const [field, value] of Object.entries({ ruc: "20111111111", series: "F002", number: "0002", netAmount: 101, igvAmount: 19, totalAmount: 119, currency: "USD" })) {
        await assert.rejects(() => assertVoucherXmlMatches(filePath, { ...voucher, [field]: value }), e => e.code === "XML_AMOUNT_MISMATCH", field);
      }
      await assert.rejects(() => assertVoucherXmlMatches(null, voucher), e => e.code === "XML_VALIDATION_FAILED");
    });
    await t.test("production adapter cannot accept an active taxpayer response as an invoice response", async () => {
      const provider = new ProductionSunatProvider(); provider.configured = true; provider.voucherEndpoint = "/voucher";
      provider.request = async () => ({ valid: true, status: "ACTIVO" });
      assert.equal((await provider.validateVoucher(voucher)).valid, false);
      provider.request = async () => ({ success: true, data: { estadoCp: "1" } });
      assert.equal((await provider.validateVoucher(voucher)).voucherVerified, true);
      provider.request = async () => ({ valid: true, status: "ACEPTADO", voucherVerified: false });
      assert.equal((await provider.validateVoucher(voucher)).valid, false);
    });
  } finally { sunatService.validateTaxpayer = originalTaxpayer; sunatService.validateVoucher = originalVoucher; await fs.rm(filePath, { force: true }); }
});
