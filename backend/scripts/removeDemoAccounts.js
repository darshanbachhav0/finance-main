import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { removeDemoAccounts } from "../src/services/demoAccountRemovalService.js";

// Removes the retired demo accounts (DNI 10000002-10000004, 10000008-10000013) and all their data
// from the database in MONGODB_URI. Shows what would go and changes nothing unless --apply.
//
//   npm run demo:remove-accounts                 (what would be removed)
//   npm run demo:remove-accounts -- --apply      (remove it; a backup is written to backend/backups)
//
// For the Render database, from your own computer (Render free has no shell):
// PowerShell:  $env:MONGODB_URI="mongodb+srv://..."; npm run demo:remove-accounts -- --apply
// Stop the server (or expect a few seconds of inconsistency) while it runs.
const apply = process.argv.includes("--apply");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI to the database first (Render -> Environment -> MONGODB_URI).");
  await connectDB();
  const result = await removeDemoAccounts(mongoose.connection.db, { apply });
  console.log(JSON.stringify(result, null, 2));
  if (!result.accounts.length) console.log(`No retired demo account is left in database "${result.database}".`);
  else if (!apply) console.log("Nothing was changed. Add --apply to remove these accounts and their data.");
  else console.log(`Removed. Backup of every removed record: ${result.backup}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
