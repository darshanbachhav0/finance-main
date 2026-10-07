import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { connectDB } from "../src/config/db.js";
import { DEFAULT_ALLOWED_DOMAINS, applyContractEmailImport, contractEmailImportSummary, prepareContractEmailImport } from "../src/services/contractEmailImportService.js";

// Sets each person's email from the HR contracts master so notification emails reach them.
//   npm run import:emails -- --file="C:\path\MAESTRO_CONTRATOS_2026-09-30.xlsx"          (dry run)
//   npm run import:emails:apply -- --file="C:\path\MAESTRO_CONTRATOS_2026-09-30.xlsx"
// Only @uma.edu.pe addresses are taken unless --allow-domains=uma.edu.pe,gmail.com (or
// --any-domain) says otherwise. The workbook holds personal data: keep it out of the repository.
const here = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const reportPath = path.resolve(argument("report") || path.join(here, `../../data/reports/contract-email-import${apply ? ".apply" : ""}.json`));
const allowedDomains = process.argv.includes("--any-domain") ? [] : (argument("allow-domains")?.split(",") || DEFAULT_ALLOWED_DOMAINS);

async function main() {
  if (!argument("file")) throw new Error("Pass the contracts master with --file=<path to MAESTRO_CONTRATOS_<date>.xlsx>.");
  const inputPath = path.resolve(argument("file"));
  if (apply && !process.env.MONGODB_URI) throw new Error("Apply mode requires an explicit MONGODB_URI. Dry-run mode may use the local default.");
  await connectDB();
  const plan = await prepareContractEmailImport(inputPath, { allowedDomains });
  const summary = contractEmailImportSummary(plan, apply ? "APPLY" : "DRY_RUN");
  const applied = apply ? await applyContractEmailImport(plan) : undefined;
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    summary,
    applied,
    plannedUpdates: plan.updates.map(({ userId, ...item }) => ({ userId: String(userId), ...item })),
    validation: plan.validation
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, ...(applied ? { emailsSet: applied.emailsSet, emailsReplaced: applied.emailsReplaced, failed: applied.failed.length } : {}), reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
