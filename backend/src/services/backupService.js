import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import BackupRun from "../models/BackupRun.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { recordAudit } from "./auditService.js";
import { generatedRoot, uploadRoot } from "./storageService.js";

// A recovery point: every MongoDB collection as Extended JSON plus the uploaded and generated
// files, in a timestamped folder under BACKUP_DIR (default backend/backups). The folder is on the
// server's own disk: copy it somewhere safe (on a host without a persistent disk it is lost when
// the server restarts).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A run that never finished (the server stopped mid-backup) no longer blocks a new one.
const STALE_RUN_MS = 60 * 60 * 1000;

export function backupDirectory(env = process.env) {
  return path.resolve(env.BACKUP_DIR || path.resolve(__dirname, "..", "..", "backups"));
}

async function copyIfPresent(source, destination) {
  try {
    await fs.access(source);
    await fs.cp(source, destination, { recursive: true, filter: (candidate) => path.basename(candidate) !== "tmp" });
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function folderSize(folder) {
  let total = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(folder, entry.name);
    total += entry.isDirectory() ? await folderSize(full) : (await fs.stat(full)).size;
  }
  return total;
}

// Writes the backup and returns its manifest. Needs an open mongoose connection.
export async function writeBackup({ root = backupDirectory(), now = new Date() } = {}) {
  const backupRoot = path.join(root, `backup-${now.toISOString().replace(/[:.]/g, "-")}`);
  const databaseRoot = path.join(backupRoot, "database");
  await fs.mkdir(databaseRoot, { recursive: true });
  const collections = await mongoose.connection.db.listCollections().toArray();
  const manifest = { createdAt: now.toISOString(), database: mongoose.connection.name, format: "MongoDB Extended JSON", collections: [], storage: {} };
  for (const { name } of collections.sort((left, right) => left.name.localeCompare(right.name))) {
    const records = await mongoose.connection.db.collection(name).find({}).toArray();
    await fs.writeFile(path.join(databaseRoot, `${name}.ejson`), mongoose.mongo.BSON.EJSON.stringify(records, null, 2, { relaxed: false }), "utf8");
    manifest.collections.push({ name, count: records.length });
  }
  manifest.storage.uploads = await copyIfPresent(uploadRoot, path.join(backupRoot, "uploads"));
  manifest.storage.generated = await copyIfPresent(generatedRoot, path.join(backupRoot, "generated"));
  await fs.writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { backupRoot, manifest, sizeBytes: await folderSize(backupRoot) };
}

async function finishRun(run, work) {
  try {
    const { backupRoot, manifest, sizeBytes } = await work;
    Object.assign(run, {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      location: backupRoot,
      database: manifest.database,
      collections: manifest.collections,
      documentCount: manifest.collections.reduce((sum, item) => sum + item.count, 0),
      sizeBytes,
      storage: manifest.storage
    });
  } catch (error) {
    Object.assign(run, { status: "FAILED", finishedAt: new Date(), error: String(error?.message || error).slice(0, 500) });
  }
  await run.save();
  return run;
}

// Starts a backup in the background and returns its run record at once; the Super Admin's page
// follows it from the history. Only one runs at a time.
export async function startBackup({ user, req, trigger = "ADMIN", wait = false } = {}) {
  const running = await BackupRun.findOne({ status: "RUNNING", startedAt: { $gte: new Date(Date.now() - STALE_RUN_MS) } }).lean();
  if (running) throw new AppError(409, "A backup is already running. Wait for it to finish.", { startedAt: running.startedAt }, ERROR_CODES.CONFLICT);
  const run = await BackupRun.create({ status: "RUNNING", trigger, triggeredBy: user?._id, triggeredByName: user?.name, startedAt: new Date(), location: backupDirectory() });
  if (user) await recordAudit({ entityType: "BackupRun", entity: run, action: "BACKUP_STARTED", user, req, module: "SUPER_ADMIN", newValues: { location: run.location } });
  const finished = finishRun(run, writeBackup());
  if (wait) return finished;
  finished.catch((error) => console.error("Backup failed", error?.message || error));
  return run;
}

export async function listBackupRuns({ limit = 20 } = {}) {
  const runs = await BackupRun.find().sort({ startedAt: -1 }).limit(Math.min(100, Math.max(1, Number(limit) || 20))).lean();
  return { data: runs, location: backupDirectory() };
}

export async function lastSuccessfulBackup() {
  return BackupRun.findOne({ status: "SUCCEEDED" }).sort({ startedAt: -1 }).lean();
}
