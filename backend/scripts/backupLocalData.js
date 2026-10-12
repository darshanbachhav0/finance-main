import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { startBackup } from "../src/services/backupService.js";

// npm run backup: MongoDB collections (Extended JSON) plus the uploaded and generated files, in a
// timestamped folder under BACKUP_DIR (default backend/backups). Recorded in the backup history
// the Super Admin sees (Super Admin > Platform settings > Backups).
async function main() {
  await connectDB();
  const run = await startBackup({ trigger: "COMMAND", wait: true });
  if (run.status !== "SUCCEEDED") throw new Error(run.error || "Backup failed.");
  console.log(JSON.stringify({ success: true, backupRoot: run.location, database: run.database, collections: run.collections, storage: run.storage, sizeBytes: run.sizeBytes }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
