import mongoose from "mongoose";
import { FICTIONAL_RATE_LABEL } from "./exchangeRateService.js";

// Versioned migration for the official SBS exchange rates (2026-11-02-sbs-exchange-rates-v1):
//   1. fictional rates written by earlier development seeds (sourceLabel "DEMO - ...", stored in
//      SUNAT's authoritative record shape) are deactivated and marked non-official - kept, never
//      deleted, so any transaction that used one still points at its record;
//   2. rates stored before buy/sell were kept get sellRate = rate (they were selling rates);
//   3. the exchange-difference mappings (EXCHANGE_GAIN 776101, EXCHANGE_LOSS 976101) are created
//      when no active one exists - an existing configuration is never changed.
// Transactions keep the rate evidence they were recorded with; nothing here rewrites them.
export const EXCHANGE_RATE_MIGRATION_KEY = "2026-11-02-sbs-exchange-rates-v1";

const EXCHANGE_MAPPINGS = Object.freeze([
  { code: "MAP-UMA-DIF-CAMBIO-GANANCIA", name: "Ganancia por diferencia de cambio", purpose: "EXCHANGE_GAIN", accountNumber: "776101" },
  { code: "MAP-UMA-DIF-CAMBIO-PERDIDA", name: "Pérdida por diferencia de cambio", purpose: "EXCHANGE_LOSS", accountNumber: "976101" }
]);

export async function runExchangeRateFoundationMigration({ apply = false, db = mongoose.connection.db, now = new Date() } = {}) {
  const rates = db.collection("exchangerates");
  const mappings = db.collection("accountingmappings");
  const fictional = await rates.find({ sourceLabel: { $regex: FICTIONAL_RATE_LABEL.source }, active: { $ne: false } }).project({ date: 1, rate: 1 }).toArray();
  const missingSell = await rates.countDocuments({ sellRate: { $exists: false }, rate: { $gt: 0 } });
  const toCreate = [];
  for (const mapping of EXCHANGE_MAPPINGS) {
    if (!await mappings.findOne({ purpose: mapping.purpose, active: { $ne: false } })) toCreate.push(mapping);
  }
  const summary = {
    key: EXCHANGE_RATE_MIGRATION_KEY,
    mode: apply ? "APPLY" : "DRY_RUN",
    fictionalRatesToDeactivate: fictional.length,
    fictionalRange: fictional.length ? [fictional.map((item) => item.date).sort((a, b) => a - b)[0], fictional.map((item) => item.date).sort((a, b) => b - a)[0]].map((date) => date.toISOString().slice(0, 10)) : [],
    ratesWithoutSellRate: missingSell,
    exchangeMappingsToCreate: toCreate.map((item) => `${item.purpose} ${item.accountNumber}`)
  };
  if (!apply) return summary;
  if (fictional.length) {
    await rates.updateMany({ _id: { $in: fictional.map((item) => item._id) } }, { $set: { active: false, authoritative: false, providerMode: "MANUAL", updatedAt: now } });
    await db.collection("auditlogs").insertOne({
      entityType: "ExchangeRate", entity: "ExchangeRate", action: "FICTIONAL_RATES_DEACTIVATED", module: "EXCHANGE_RATES", actorName: "System",
      comments: `${fictional.length} fictional development rates deactivated (${EXCHANGE_RATE_MIGRATION_KEY}).`,
      newValues: { count: fictional.length, range: summary.fictionalRange }, createdAt: now
    });
  }
  if (missingSell) await rates.updateMany({ sellRate: { $exists: false }, rate: { $gt: 0 } }, [{ $set: { sellRate: "$rate" } }]);
  for (const mapping of toCreate) {
    await mappings.insertOne({ ...mapping, requestType: "*", expenseNature: "*", bank: "*", currency: "*", active: true, createdAt: now, updatedAt: now });
  }
  await db.collection("migrationruns").updateOne({ key: EXCHANGE_RATE_MIGRATION_KEY }, { $set: { summary, appliedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  return summary;
}

// Run by the server on start-up (server.js), so a deployment without a shell (Render free plan)
// still gets it: it checks first and writes only when something is pending, so later starts are
// no-ops. The exchange-rate worker then stores the official rates.
export async function applyExchangeRateFoundationIfPending(options = {}) {
  const pending = await runExchangeRateFoundationMigration({ ...options, apply: false });
  if (!pending.fictionalRatesToDeactivate && !pending.ratesWithoutSellRate && !pending.exchangeMappingsToCreate.length) return { ...pending, applied: false };
  return { ...await runExchangeRateFoundationMigration({ ...options, apply: true }), applied: true };
}
