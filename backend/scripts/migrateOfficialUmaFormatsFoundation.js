import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import {
  OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY,
  runOfficialFormatsFoundationMigration
} from "../src/services/officialFormatsFoundationMigrationService.js";

const apply = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.resolve(__dirname, "..", "migration-reports");

async function main() {
  await connectDB();
  const report = await runOfficialFormatsFoundationMigration({ db: mongoose.connection.db, apply, recordRun: false });

  if (apply && !report.alreadyApplied) {
    const [
      { default: EmployeeReimbursementBankAccount },
      { default: FinanceConfiguration },
      { default: FinancialRequest },
      { default: Supplier },
      { default: SupplierBankAccount },
      { default: User }
    ] = await Promise.all([
      import("../src/models/EmployeeReimbursementBankAccount.js"),
      import("../src/models/FinanceConfiguration.js"),
      import("../src/models/FinancialRequest.js"),
      import("../src/models/Supplier.js"),
      import("../src/models/SupplierBankAccount.js"),
      import("../src/models/User.js")
    ]);
    await Promise.all([
      Supplier.createIndexes(),
      SupplierBankAccount.createIndexes(),
      EmployeeReimbursementBankAccount.createIndexes(),
      FinanceConfiguration.createIndexes(),
      FinancialRequest.createIndexes(),
      User.createIndexes()
    ]);
  }

  await fs.mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFile = path.join(
    reportDir,
    `${OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY}-${apply ? "apply" : "dry-run"}-${stamp}.json`
  );
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (apply && !report.alreadyApplied) {
    await mongoose.connection.db.collection("migrationruns").updateOne(
      { key: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY },
      {
        $setOnInsert: {
          key: OFFICIAL_FORMATS_FOUNDATION_MIGRATION_KEY,
          appliedAt: new Date(),
          summary: report.summary,
          createdAt: new Date()
        },
        $set: { reportFile, updatedAt: new Date() }
      },
      { upsert: true }
    );
  }
  console.log(JSON.stringify({
    mode: report.mode,
    alreadyApplied: report.alreadyApplied,
    reportFile,
    summary: report.summary
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
