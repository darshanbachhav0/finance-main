import "dotenv/config";
import path from "node:path";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { connectDB } from "../src/config/db.js";
import { applyCascadeImport, planCascadeImport, readCascadeFile } from "../src/services/cecoCascadeImportService.js";

// npm run import:ceco-cascade            dry run: what would change
// npm run import:ceco-cascade:apply      writes parent, level and line onto the existing CECOs
//   -- --create-missing                  also adds the cascade's CECOs that do not exist yet
const here = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const createMissing = process.argv.includes("--create-missing");
const fileArgument = process.argv.find((arg) => arg.startsWith("--file="));
const inputPath = path.resolve(fileArgument?.slice(7) || path.join(here, "../../data/ceco-cascade.json"));

async function main() {
  if (apply && !process.env.MONGODB_URI) throw new Error("Apply mode requires an explicit MONGODB_URI. Dry-run mode may use the local default.");
  await connectDB();
  const rows = await readCascadeFile(inputPath);
  const plan = await planCascadeImport(rows);
  const applied = apply ? await applyCascadeImport(plan, rows, { createMissing }) : undefined;
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", inputPath, ...plan, ...(applied || {}) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
