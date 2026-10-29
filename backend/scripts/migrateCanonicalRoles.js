import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { startBackup } from "../src/services/backupService.js";
import { rollbackCanonicalRoleMigration, runCanonicalRoleMigration } from "../src/services/canonicalRoleMigrationService.js";

// Moves accounts to the canonical roles and permissions (shared/accessControl.mjs).
//
//   Dry run (default, writes nothing):  npm run migrate:canonical-roles
//   Apply (backup first):               npm run migrate:canonical-roles:apply
//   Roll back an apply:                 npm run migrate:canonical-roles -- --rollback=data/reports/<apply report>.json
//
// --apply takes a full backup (npm run backup) before writing and stops if it fails; pass
// --skip-backup only when a backup was taken another way. Every run writes its report to
// backend/data/reports: the dry run lists each affected person with their old and new access, and
// the apply report is the input of --rollback. Requests, approval history, payments, actas and
// audit logs are never modified.
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const rollback = argument("rollback");
const reportsDir = fileURLToPath(new URL("../data/reports/", import.meta.url));

async function writeReport(kind, payload) {
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `canonical-roles-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  return file;
}

async function main() {
  await connectDB();
  const database = mongoose.connection.name;
  if (rollback) {
    const report = JSON.parse(await fs.readFile(path.resolve(rollback), "utf8"));
    const result = await rollbackCanonicalRoleMigration(report, { force: process.argv.includes("--force") });
    console.log(JSON.stringify({ database, mode: "ROLLBACK", ...result }, null, 2));
    return;
  }
  if (apply && !process.argv.includes("--skip-backup")) {
    const run = await startBackup({ trigger: "MIGRATION", wait: true });
    if (run.status !== "SUCCEEDED") throw new Error(`Backup failed, nothing was migrated: ${run.error || run.status}`);
    console.log(`Backup written to ${run.location}`);
  }
  const result = await runCanonicalRoleMigration({ apply });
  const file = await writeReport(apply ? "apply" : "dry_run", { database, ...result });
  console.log(JSON.stringify({ database, ...result.summary, report: file }, null, 2));
  if (!apply) console.log("\nDry run only. Review the report, then run with --apply.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
