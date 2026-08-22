import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { generatedRoot, uploadRoot } from "../src/services/storageService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.resolve(__dirname, "..", "backups", `backup-${timestamp}`);
const databaseRoot = path.join(backupRoot, "database");

async function copyIfPresent(source, destination) {
  try {
    await fs.access(source);
    await fs.cp(source, destination, {
      recursive: true,
      filter: (candidate) => path.basename(candidate) !== "tmp"
    });
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  await connectDB();
  await fs.mkdir(databaseRoot, { recursive: true });
  const collections = await mongoose.connection.db.listCollections().toArray();
  const manifest = {
    createdAt: new Date().toISOString(),
    database: mongoose.connection.name,
    format: "MongoDB Extended JSON",
    collections: [],
    storage: {}
  };

  for (const { name } of collections.sort((left, right) => left.name.localeCompare(right.name))) {
    const records = await mongoose.connection.db.collection(name).find({}).toArray();
    await fs.writeFile(
      path.join(databaseRoot, `${name}.ejson`),
      mongoose.mongo.BSON.EJSON.stringify(records, null, 2, { relaxed: false }),
      "utf8"
    );
    manifest.collections.push({ name, count: records.length });
  }

  manifest.storage.uploads = await copyIfPresent(uploadRoot, path.join(backupRoot, "uploads"));
  manifest.storage.generated = await copyIfPresent(generatedRoot, path.join(backupRoot, "generated"));
  await fs.writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify({ success: true, backupRoot, manifest }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
