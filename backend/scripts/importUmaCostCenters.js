import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { connectDB } from "../src/config/db.js";
import { applyCecoImport, cecoImportSummary, prepareCecoImport } from "../src/services/cecoImportService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const fileArgument = process.argv.find((arg) => arg.startsWith("--file="));
const reportArgument = process.argv.find((arg) => arg.startsWith("--report="));
const inputPath = path.resolve(fileArgument?.slice(7) || path.join(here, "../../data/Centro de Costo - Tesoreria.xlsx"));
const reportPath = path.resolve(reportArgument?.slice(9) || path.join(here, `../../data/reports/ceco-import-validation${apply ? ".apply" : ""}.json`));

async function main() {
  if (apply && !process.env.MONGODB_URI) throw new Error("Apply mode requires an explicit MONGODB_URI. Dry-run mode may use the local default.");
  await connectDB();
  const plan = await prepareCecoImport(inputPath);
  if (apply && (plan.validation.cecoConflicts.length || plan.validation.ambiguousEmployees.length)) throw new Error("Apply blocked: resolve ambiguous Cost Centers and employee mappings in the dry-run report before institutional cutover.");
  const summary = cecoImportSummary(plan, apply ? "APPLY" : "DRY_RUN");
  const applied = apply ? await applyCecoImport(plan) : undefined;
  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    summary,
    applied,
    validation: plan.validation,
    plannedAssignments: plan.assignments.map((item) => ({ dni: item.dni, cecoCode: item.cecoCode, sourceRow: item.sourceRow, matchedBy: item.matchedBy })),
    plannedCostCenters: plan.cecoRecords
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, ...(applied || {}), reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
