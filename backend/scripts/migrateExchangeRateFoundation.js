import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { runExchangeRateFoundationMigration } from "../src/services/exchangeRateFoundationMigrationService.js";
import { syncOfficialExchangeRates } from "../src/services/exchangeRateSyncService.js";

// Official SBS exchange rates: deactivates fictional seed rates, completes sellRate on stored rates,
// creates the 776101 / 976101 exchange-difference mappings when missing, then (on --apply) runs the
// first synchronization.
//
//   Dry run (default, writes nothing):  npm run migrate:exchange-rates
//   Apply:                              npm run migrate:exchange-rates:apply
//
// Each run writes its report to backend/data/reports. Nothing is deleted.
const apply = process.argv.includes("--apply");
const reportsDir = fileURLToPath(new URL("../data/reports/", import.meta.url));

async function main() {
  await connectDB();
  const database = mongoose.connection.name;
  const summary = await runExchangeRateFoundationMigration({ apply });
  const sync = apply ? await syncOfficialExchangeRates({ trigger: "MANUAL" }) : null;
  const report = { database, ...summary, ...(sync ? { sync: { status: sync.run.status, sources: sync.run.sources, inserted: sync.inserted, latestDate: sync.latestDate } } : {}) };
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `exchange-rates-${apply ? "apply" : "dry_run"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ ...report, report: file }, null, 2));
  if (!apply) console.log("\nDry run only. Review the report, then run with --apply.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
