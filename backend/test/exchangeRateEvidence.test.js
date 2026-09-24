import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ExchangeRate from "../src/models/ExchangeRate.js";
import { verifyExchangeRatePayload } from "../src/controllers/masterDataController.js";

test("ExchangeRate carries first-class retrieval evidence (source URL, retrieval timestamp)", { timeout: 30000 }, async (t) => {
  const databaseName = `erp_exchange_rate_evidence_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await t.test("a manual/reference entry gets a retrieval timestamp but no source URL", async () => {
      const before = Date.now();
      const payload = { rate: "3.75", date: "2026-09-14", providerMode: "MANUAL" };
      await verifyExchangeRatePayload(payload);
      assert.equal(payload.authoritative, false);
      assert.equal(payload.providerMode, "MANUAL");
      assert.equal(payload.sourceUrl, undefined);
      assert.ok(payload.retrievedAt instanceof Date && payload.retrievedAt.getTime() >= before);
    });

    await t.test("a BCRP reference entry is still explicitly non-authoritative with a retrieval timestamp", async () => {
      const payload = { rate: "3.7", date: "2026-09-14", providerMode: "BCRP_FALLBACK" };
      await verifyExchangeRatePayload(payload);
      assert.equal(payload.authoritative, false);
      assert.equal(payload.providerMode, "BCRP_FALLBACK");
      assert.ok(payload.retrievedAt instanceof Date);
    });

    await t.test("the schema persists source URL, retrieval timestamp and authoritative evidence together", async () => {
      const record = await ExchangeRate.create({
        currency: "USD", date: "2026-09-14", period: "2026-09", rate: 3.8,
        source: "SUNAT", sourceLabel: "SUNAT", providerMode: "SUNAT", authoritative: true,
        sourceUrl: "https://api.sunat.gob.pe/v1/tipo-cambio", retrievedAt: new Date("2026-09-14T08:00:00Z")
      });
      const loaded = await ExchangeRate.findById(record._id).lean();
      assert.equal(loaded.sourceUrl, "https://api.sunat.gob.pe/v1/tipo-cambio");
      assert.equal(loaded.retrievedAt.toISOString(), "2026-09-14T08:00:00.000Z");
      assert.equal(loaded.authoritative, true);
    });

    await t.test("retrievedAt defaults to now when not explicitly supplied", async () => {
      const before = Date.now();
      const record = await ExchangeRate.create({ currency: "USD", date: "2026-09-15", period: "2026-09", rate: 3.81, providerMode: "MANUAL" });
      assert.ok(record.retrievedAt.getTime() >= before);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
