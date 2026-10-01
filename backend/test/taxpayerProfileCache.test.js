import test from "node:test";
import assert from "node:assert/strict";
import { cachedTaxpayerProfile, profileExpiry } from "../src/services/taxpayerProfileCache.js";
import { inProcessWorkerFlags } from "../src/workers/inProcessWorkers.js";

const ruc = "20550807123";
const profile = () => ({ found: true, officialSource: true, source: "SUNAT_CONSULTA_RUC", queriedAt: new Date().toISOString(), data: { rucDni: ruc, legalName: "UMA", active: true, habido: true } });
test("durable taxpayer cache reuses original official evidence without renewing its date", async () => {
  let record;
  const model = { findById: () => ({ lean: async () => record }), updateOne: async (_, update) => { record = update.$set; } };
  const first = await cachedTaxpayerProfile(ruc, async () => profile(), { model });
  const second = await cachedTaxpayerProfile(ruc, async () => { throw Error("must not query"); }, { model });
  assert.equal(second.cached, true);
  assert.equal(first.queriedAt, second.queriedAt);
  assert.equal(+new Date(first.cacheExpiresAt), +new Date(second.cacheExpiresAt));
});
test("expired evidence fails closed when SUNAT is unavailable", async () => {
  const model = { findById: () => ({ lean: async () => ({ profile: profile(), expiresAt: new Date(0) }) }) };
  await assert.rejects(cachedTaxpayerProfile(ruc, async () => { throw Error("SUNAT offline"); }, { model }), /SUNAT offline/);
});
test("cache rejects mismatched, manual, undated and expired dataset evidence", () => {
  for (const p of [ { ...profile(), officialSource: false }, { ...profile(), source: "MANUAL" }, { ...profile(), queriedAt: undefined }, { ...profile(), source: "SUNAT_PUBLIC_PADRON_RUC", datasetDate: "2020-01-01" } ]) {
    assert.throws(() => profileExpiry(p, ruc));
  }
  assert.throws(() => profileExpiry(profile(), "20123456789"));
});
test("inactive taxpayer result is preserved, never converted to an approval", async () => {
  const p = profile(); p.data.active = false;
  const model = { findById: () => ({ lean: async () => null }), updateOne: async () => {} };
  assert.equal((await cachedTaxpayerProfile(ruc, async () => p, { model })).data.active, false);
});
test("cloud cache mode disables full dataset indexing even if old worker flag is enabled", () => {
  assert.equal(inProcessWorkerFlags({ NODE_ENV: "production", SUNAT_PROVIDER_MODE: "PADRON", SUNAT_TAXPAYER_CACHE_MODE: "MONGO", SUNAT_PADRON_WORKER_ENABLED: "true" }).padron, false);
});
