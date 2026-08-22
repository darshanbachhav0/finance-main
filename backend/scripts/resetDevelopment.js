import "dotenv/config";
import fs from "fs/promises";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { generatedRoot, uploadRoot } from "../src/services/storageService.js";

if (process.env.NODE_ENV === "production") throw new Error("Development reset is disabled in production.");
if (!process.argv.includes("--confirm")) throw new Error("Development reset requires --confirm.");

try {
  await connectDB();
  const databaseName = mongoose.connection.name;
  if (!/erp_financial|development|dev/i.test(databaseName)) throw new Error(`Refusing to reset non-development database ${databaseName}.`);
  await mongoose.connection.dropDatabase();
  const purgedStorage = process.argv.includes("--purge-files");
  if (purgedStorage) {
    for (const storageRoot of [uploadRoot, generatedRoot]) {
      await fs.rm(storageRoot, { recursive: true, force: true });
      await fs.mkdir(storageRoot, { recursive: true });
    }
  }
  console.log(`Development database ${databaseName} reset${purgedStorage ? " and active uploads/generated files purged" : ""}. Run npm run seed to recreate scenarios.`);
} finally {
  await mongoose.disconnect();
}
