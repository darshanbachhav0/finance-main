import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { migrateRetiredRoles } from "../src/services/legacyRoleService.js";

// Shows (dry run) or applies (--apply) the move of retired roles - today Budget -> Treasury. The
// server also applies it at start, so this is for checking a database beforehand.
const apply = process.argv.includes("--apply");
await connectDB();
try {
  const summary = await migrateRetiredRoles({ apply });
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", summary }, null, 2));
} finally {
  await mongoose.disconnect();
}
