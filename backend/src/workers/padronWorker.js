// SUNAT public Padrón refresh loop. Takes a file lock in the Padrón data directory, refreshes
// on its own schedule (03:00 America/Lima) with a heartbeat, and runs until stopped.
// Used in-process by server.js (production on Render, where the web service owns the only disk)
// and by the standalone CLI backend/scripts/padronWorker.js (local/Docker hosting).
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureSunatPadron, getSunatPadronStatus, pruneSunatPadronGenerations } from "../services/sunatPadronService.js";

const LOCK_STALE_MS = 60000;
const LOCK_RETRY_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns an open lease file handle, or null when another live updater holds the lock.
async function acquireLock(lock) {
  try { return await fs.open(lock, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(await fs.readFile(lock, "utf8").catch(() => "{}") || "{}");
    const stat = await fs.stat(lock);
    let alive = true;
    if (owner.host === os.hostname() && owner.pid) { try { process.kill(owner.pid, 0); } catch (e) { alive = e.code !== "ESRCH"; } }
    // A live holder refreshes the lease every 15s. A dead local pid, or a lease nobody has
    // refreshed for a minute (e.g. the previous Render instance, on another hostname), is stale.
    if (alive && Date.now() - stat.mtimeMs < LOCK_STALE_MS) return null;
    await fs.unlink(lock).catch(() => {});
    try { return await fs.open(lock, "wx"); } catch (retryError) { if (retryError.code === "EEXIST") return null; throw retryError; }
  }
}

async function migrateLegacyDirectory(directory) {
  const legacy = process.env.SUNAT_PADRON_LEGACY_DIR;
  if (!legacy || path.resolve(legacy) === path.resolve(directory)) return;
  try {
    await fs.access(path.join(directory, "current", "manifest.json"));
  } catch {
    try {
      await fs.access(path.join(legacy, "current", "manifest.json"));
      const temp = path.join(directory, "migration-current");
      await fs.cp(path.join(legacy, "current"), temp, { recursive: true, preserveTimestamps: true });
      await fs.rename(temp, path.join(directory, "current"));
    } catch (error) { if (error.code !== "ENOENT") console.warn("Padrón migration:", error.message); }
  }
}

// once: run a single refresh attempt and resolve (bootstrap). waitForLock: keep retrying the
// lock (in-process use - a just-replaced instance's lease can take up to a minute to go stale)
// instead of giving up immediately (CLI use). Resolves with { ran, failed }.
export async function runPadronWorker({ once = false, waitForLock = false, shouldStop = () => false } = {}) {
  const directory = (await getSunatPadronStatus()).dataDir;
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, "worker.lock");
  let lease = await acquireLock(lock);
  while (!lease && waitForLock && !shouldStop()) {
    for (let waited = 0; waited < LOCK_RETRY_MS && !shouldStop(); waited += 1000) await sleep(1000);
    if (!shouldStop()) lease = await acquireLock(lock);
  }
  if (!lease) { console.log("Padrón updater already running."); return { ran: false, failed: false }; }
  await lease.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname() }));
  const heartbeat = setInterval(() => { const now = new Date(); void lease.utimes(now, now).catch(() => {}); }, 15000);
  async function release() { clearInterval(heartbeat); await lease.close(); await fs.unlink(lock).catch(() => {}); }
  async function workerState(update) {
    const file = path.join(directory, "worker-state.json");
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ ...update, pid: process.pid, host: os.hostname(), heartbeatAt: new Date().toISOString() }));
    await fs.rename(`${file}.tmp`, file);
  }
  let failed = false;
  let lastWorkerReport = 0;
  try {
    // One-time migration runs in this worker, never in the web request path.
    await migrateLegacyDirectory(directory);
    let next = 0, failures = 0;
    do {
      if (Date.now() >= next) {
        try {
          const result = await ensureSunatPadron({ check: next > 0 });
          if (result.refreshError) throw new Error(result.refreshError);
          await pruneSunatPadronGenerations();
          failures = 0;
          // Next check at 03:00 America/Lima (UTC-5, no seasonal offset).
          const tomorrow = new Date(); tomorrow.setUTCHours(8, 0, 0, 0);
          if (tomorrow.getTime() <= Date.now()) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          next = tomorrow.getTime();
          console.log(`Padrón ready; next check ${new Date(next).toISOString()}`);
        } catch (error) {
          failures++;
          next = Date.now() + [60000, 300000, 900000, 3600000][Math.min(failures - 1, 3)];
          console.error(`Padrón update failed: ${error.message}. Retry ${new Date(next).toISOString()}`);
          if (once) failed = true;
        }
      }
      if (Date.now() >= lastWorkerReport) { await workerState({ nextCheckAt: new Date(next).toISOString(), failures }); lastWorkerReport = Date.now() + 15000; }
      if (once) break;
      await sleep(1000);
    } while (!shouldStop());
  } finally { await release(); }
  return { ran: true, failed };
}

// In-process entry point used by server.js.
export function startPadronWorker() {
  let stopping = false;
  const done = runPadronWorker({ waitForLock: true, shouldStop: () => stopping })
    .catch((error) => console.error("Padrón worker stopped:", error?.stack || error?.message || error));
  return {
    name: "sunat-padron",
    done,
    async stop() { stopping = true; await done; }
  };
}
