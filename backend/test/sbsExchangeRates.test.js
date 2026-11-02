import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AuditLog from "../src/models/AuditLog.js";
import ExchangeRate from "../src/models/ExchangeRate.js";
import ExchangeRateSyncRun from "../src/models/ExchangeRateSyncRun.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { applyExchangeRateFoundationIfPending, runExchangeRateFoundationMigration } from "../src/services/exchangeRateFoundationMigrationService.js";
import { resolveExchangeRateSnapshot } from "../src/services/exchangeRateService.js";
import { expectedLatestEffectiveDate, syncOfficialExchangeRates } from "../src/services/exchangeRateSyncService.js";
import { fetchBcrpSbsRates, fetchSunatPublishedRate, parseBcrpSbsSeries, parseSunatRateText, publishedRate } from "../src/services/sbsExchangeRateProvider.js";

// Real publications, as the sources answered (SUNAT tipoCambio.txt on 2026-11-02; a BCRPData
// SBS series payload in its documented shape).
const SUNAT_TEXT = "02/11/2026|3.458|3.467|";
const BCRP_PAYLOAD = {
  config: { title: "Tipo de cambio", series: [{ name: "TC Sistema bancario SBS (S/ por US$) - Compra" }, { name: "TC Sistema bancario SBS (S/ por US$) - Venta" }] },
  periods: [
    { name: "29.Oct.26", values: ["3.462", "3.471"] },
    { name: "30.Oct.26", values: ["3.458", "3.467"] },
    { name: "31.Oct.26", values: ["n.d.", "n.d."] }
  ]
};
const response = (body, contentType) => ({ ok: true, status: 200, headers: { get: () => contentType }, text: async () => body });

test("official SBS publications are parsed exactly; anything else is a source failure", async () => {
  assert.deepEqual(parseSunatRateText(SUNAT_TEXT), { date: "2026-11-02", buyRate: 3.458, sellRate: 3.467 });
  assert.throws(() => parseSunatRateText("31/02/2026|3.4|3.5|"), /not well formed/);
  assert.throws(() => parseSunatRateText("02/11/2026|3.6|3.5|"), /not well formed/, "compra never above venta");
  assert.throws(() => parseSunatRateText("<html>"), /did not return/);
  assert.equal(publishedRate("n.d."), null);
  assert.deepEqual(parseBcrpSbsSeries(BCRP_PAYLOAD).map((rate) => [rate.sbsClosingDate, rate.effectiveDate, rate.buyRate, rate.sellRate]), [
    ["2026-10-29", "2026-10-30", 3.462, 3.471],
    ["2026-10-30", "2026-10-31", 3.458, 3.467]
  ], "a closing applies from the next day; days without publication are skipped");
  const sunat = await fetchSunatPublishedRate({ fetchImpl: async () => response(SUNAT_TEXT, "text/plain") });
  assert.equal(sunat.source, "SUNAT_SBS");
  assert.equal(sunat.effectiveDate, "2026-11-02");
  await assert.rejects(() => fetchSunatPublishedRate({ fetchImpl: async () => response("<!DOCTYPE html><title>Pardon Our Interruption</title>", "text/html") }), /web page/);
  await assert.rejects(() => fetchBcrpSbsRates({ from: "2026-10-20", to: "2026-11-02", fetchImpl: async () => response("<!DOCTYPE html><html>", "text/html; charset=UTF-8") }), /bot protection/);
  const bcrp = await fetchBcrpSbsRates({ from: "2026-10-20", to: "2026-11-02", fetchImpl: async (url) => {
    assert.match(url, /PD04639PD-PD04640PD\/json\/2026-10-20\/2026-11-02$/);
    return response(JSON.stringify(BCRP_PAYLOAD), "application/json");
  } });
  assert.equal(bcrp.length, 2);
});

test("the expected publication follows the SBS business days (weekends and holidays carry the last close)", () => {
  assert.equal(expectedLatestEffectiveDate("2026-11-02"), "2026-10-31", "Monday: Friday's close, applicable from Saturday");
  assert.equal(expectedLatestEffectiveDate("2026-11-03"), "2026-11-03", "Tuesday: Monday's close");
  assert.equal(expectedLatestEffectiveDate("2026-07-30"), "2026-07-28", "after the 28/29 July holidays: Monday 27's close");
});

test("automatic synchronization, history, alerts and the applicable rate", { timeout: 60000 }, async (t) => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/erp_sbs_rates_${process.pid}_${Date.now()}`, { serverSelectionTimeoutMS: 5000 });
  const now = new Date("2026-11-02T15:00:00Z");
  const noRetry = { retries: 0 };
  try {
    const accountant = await User.create({ name: "Contabilidad", email: "fx.con@test.local", passwordHash: "x", role: "Accounting" });
    await t.test("both sources stored once per applicable date, with buy, sell, source and retrieval time", async () => {
      const result = await syncOfficialExchangeRates({ now, retry: noRetry, sources: {
        SUNAT_SBS: async () => [{ ...parseSunatRateText(SUNAT_TEXT), effectiveDate: "2026-11-02", source: "SUNAT_SBS", sourceLabel: "SBS, published by SUNAT", sourceUrl: "https://www.sunat.gob.pe/a/txt/tipoCambio.txt" }],
        BCRP_SBS: async () => parseBcrpSbsSeries(BCRP_PAYLOAD).map((rate) => ({ ...rate, date: rate.effectiveDate, source: "BCRP_SBS", sourceLabel: "SBS, BCRPData", sourceUrl: "https://estadisticas.bcrp.gob.pe" }))
      } });
      assert.equal(result.run.status, "OK");
      assert.equal(result.inserted, 3);
      assert.equal(result.latestDate, "2026-11-02");
      assert.equal(result.stale, false);
      const monday = await ExchangeRate.findOne({ date: new Date("2026-11-02T00:00:00Z") }).lean();
      assert.deepEqual([monday.buyRate, monday.sellRate, monday.rate, monday.providerMode, monday.authoritative], [3.458, 3.467, 3.467, "SBS", true]);
      assert.ok(monday.retrievedAt instanceof Date);
      const saturday = await ExchangeRate.findOne({ date: new Date("2026-10-31T00:00:00Z") }).lean();
      assert.equal(saturday.sbsClosingDate.toISOString().slice(0, 10), "2026-10-30");
      const again = await syncOfficialExchangeRates({ now, retry: noRetry, sources: { SUNAT_SBS: async () => [{ ...parseSunatRateText(SUNAT_TEXT), source: "SUNAT_SBS" }] } });
      assert.equal(again.inserted + again.updated, 0, "running it again changes nothing");
    });

    await t.test("weekends use the last published rate and say which date it is", async () => {
      await ExchangeRate.deleteOne({ date: new Date("2026-11-02T00:00:00Z") });
      const sunday = await resolveExchangeRateSnapshot("USD", "2026-11-01", { now, syncNow: async () => {} });
      assert.equal(sunday.rate, 3.467);
      assert.equal(sunday.date.toISOString().slice(0, 10), "2026-10-31");
      assert.equal(sunday.fallback.used, true);
      assert.equal(sunday.sbsClosingDate.toISOString().slice(0, 10), "2026-10-30");
      const buy = await resolveExchangeRateSnapshot("USD", "2026-11-01", { now, side: "BUY", syncNow: async () => {} });
      assert.equal(buy.rate, 3.458);
    });

    await t.test("a date whose publication is missing is never filled with an older rate", async () => {
      await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-11-03", { now: new Date("2026-11-03T15:00:00Z"), syncNow: async () => {} }), (error) => error.code === "EXCHANGE_RATE_MISSING" && error.details.expectedPublication === "2026-11-03");
      // Monday is served by Saturday's record (Friday's close): nothing to fetch.
      let synced = 0;
      const monday = await resolveExchangeRateSnapshot("USD", "2026-11-02", { now, syncNow: async () => { synced += 1; } });
      assert.equal(monday.sbsClosingDate.toISOString().slice(0, 10), "2026-10-30");
      assert.equal(synced, 0);
      // Tuesday needs Monday's close: fetched on demand.
      const recovered = await resolveExchangeRateSnapshot("USD", "2026-11-03", { now: new Date("2026-11-03T15:00:00Z"), syncNow: async () => {
        synced += 1;
        await ExchangeRate.create({ currency: "USD", date: new Date("2026-11-03T00:00:00Z"), period: "2026-11", rate: 3.467, buyRate: 3.458, sellRate: 3.467, source: "SUNAT_SBS", providerMode: "SBS", authoritative: true });
      } });
      assert.equal(synced, 1, "a missing publication is fetched on demand");
      assert.equal(recovered.fallback.used, false);
      await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-11-05", { now }), (error) => error.code === "EXCHANGE_RATE_MISSING", "a future date has no rate");
    });

    await t.test("a manual entry is used only when allowed, and is labelled as such", async () => {
      const day = new Date("2026-11-04T00:00:00Z");
      await ExchangeRate.create({ currency: "USD", date: day, period: "2026-11", rate: 3.5, source: "MANUAL", providerMode: "MANUAL", authoritative: false, createdBy: accountant._id });
      const later = new Date("2026-11-04T20:00:00Z");
      await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-11-04", { now: later, syncNow: async () => {}, allowReference: false }), (error) => error.code === "EXCHANGE_RATE_MISSING");
      const manual = await resolveExchangeRateSnapshot("USD", "2026-11-04", { now: later, syncNow: async () => {}, allowReference: true });
      assert.equal(manual.authoritative, false);
      assert.equal(manual.fallback.reason, "OFFICIAL_RATE_UNAVAILABLE_MANUAL_ENTRY");
      // The official rate replaces it, and the replacement is audited.
      await syncOfficialExchangeRates({ now: later, retry: noRetry, sources: { SUNAT_SBS: async () => [{ date: "2026-11-04", buyRate: 3.46, sellRate: 3.469, source: "SUNAT_SBS", confirmedBy: ["SUNAT_SBS"] }] } });
      const replaced = await ExchangeRate.findOne({ date: day }).lean();
      assert.deepEqual([replaced.providerMode, replaced.sellRate], ["SBS", 3.469]);
      assert.ok(await AuditLog.exists({ action: "MANUAL_RATE_REPLACED_BY_OFFICIAL" }));
    });

    await t.test("sources that disagree: SUNAT's table wins and the disagreement is reported", async () => {
      const result = await syncOfficialExchangeRates({ now, retry: noRetry, sources: {
        SUNAT_SBS: async () => [{ date: "2026-10-31", buyRate: 3.458, sellRate: 3.467, source: "SUNAT_SBS" }],
        BCRP_SBS: async () => [{ date: "2026-10-31", buyRate: 3.459, sellRate: 3.468, source: "BCRP_SBS" }]
      } });
      assert.equal(result.disagreements.length, 1);
      assert.equal((await ExchangeRate.findOne({ date: new Date("2026-10-31T00:00:00Z") }).lean()).sellRate, 3.467);
    });

    await t.test("failures are retried, logged, and an out-of-date rate alerts Contabilidad", async () => {
      let attempts = 0;
      const result = await syncOfficialExchangeRates({ now: new Date("2026-11-10T15:00:00Z"), retry: { retries: 2, delays: [0, 0], wait: async () => {} }, sources: {
        SUNAT_SBS: async () => { attempts += 1; throw new Error("SUNAT did not answer"); }
      } });
      assert.equal(attempts, 3);
      assert.equal(result.run.status, "FAILED");
      assert.equal(result.stale, true);
      assert.equal((await ExchangeRateSyncRun.findById(result.run._id).lean()).sources[0].error, "SUNAT did not answer");
      assert.equal(await Notification.countDocuments({ user: accountant._id, type: "EXCHANGE_RATE_STALE" }), 1);
    });

    await t.test("migration deactivates fictional seed rates and adds the 776101 / 976101 mappings", async () => {
      await ExchangeRate.create({ currency: "USD", date: new Date("2026-09-01T00:00:00Z"), period: "2026-09", rate: 3.75, source: "SUNAT", providerMode: "SUNAT", authoritative: true, sourceLabel: "DEMO - tipo de cambio ficticio del seed de desarrollo UMA (formato SUNAT; no publicado por SUNAT)" });
      await assert.rejects(() => resolveExchangeRateSnapshot("USD", "2026-09-01", { now, syncNow: async () => {} }), (error) => error.code === "EXCHANGE_RATE_MISSING", "a fictional rate is never used");
      const dry = await runExchangeRateFoundationMigration();
      assert.equal(dry.fictionalRatesToDeactivate, 1);
      assert.deepEqual(dry.exchangeMappingsToCreate, ["EXCHANGE_GAIN 776101", "EXCHANGE_LOSS 976101"]);
      // The server applies it on start-up; a later start finds nothing pending and writes nothing.
      assert.equal((await applyExchangeRateFoundationIfPending()).applied, true);
      const runs = await mongoose.connection.db.collection("migrationruns").find().toArray();
      assert.equal((await applyExchangeRateFoundationIfPending()).applied, false);
      assert.deepEqual((await mongoose.connection.db.collection("migrationruns").find().toArray()).map((run) => String(run.updatedAt)), runs.map((run) => String(run.updatedAt)));
      const fictional = await ExchangeRate.findOne({ date: new Date("2026-09-01T00:00:00Z") }).lean();
      assert.deepEqual([fictional.active, fictional.authoritative], [false, false], "kept, not deleted");
      assert.equal(await mongoose.connection.db.collection("accountingmappings").countDocuments({ purpose: { $in: ["EXCHANGE_GAIN", "EXCHANGE_LOSS"] } }), 2);
      const again = await runExchangeRateFoundationMigration();
      assert.deepEqual([again.fictionalRatesToDeactivate, again.exchangeMappingsToCreate.length], [0, 0]);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
