// Long-running SUNAT public Padron daemon: takes a lock, refreshes on its own schedule with a
// heartbeat, and keeps running until SIGTERM/SIGINT (or once, with --once, for a bootstrap run
// from deploy tooling). Reach for this to run padron sync as a standing service/process manager
// entry. For a single manual refresh use syncSunatPadron.js instead; for status only, padronStatus.js.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureSunatPadron, getSunatPadronStatus, pruneSunatPadronGenerations } from "../src/services/sunatPadronService.js";

const directory = (await getSunatPadronStatus()).dataDir;
await fs.mkdir(directory, { recursive: true });
const lock = path.join(directory, "worker.lock");
let lease;
try { lease = await fs.open(lock, "wx"); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  const owner = JSON.parse(await fs.readFile(lock, "utf8").catch(() => "{}"));
  const stat = await fs.stat(lock);
  let alive = true;
  if (owner.host === os.hostname() && owner.pid) { try { process.kill(owner.pid, 0); } catch (e) { alive = e.code !== "ESRCH"; } }
  if (alive || Date.now() - stat.mtimeMs < 60000) { console.log("Padrón updater already running."); process.exit(0); }
  await fs.unlink(lock);
  lease = await fs.open(lock, "wx");
}
await lease.writeFile(JSON.stringify({pid:process.pid,host:os.hostname()}));
const heartbeat = setInterval(() => { const now = new Date(); void lease.utimes(now,now).catch(()=>{}); }, 15000);
async function release() {clearInterval(heartbeat);await lease.close();await fs.unlink(lock).catch(()=>{});}
async function workerState(update) {
 const file = path.join(directory,"worker-state.json");
 await fs.writeFile(`${file}.tmp`,JSON.stringify({...update,pid:process.pid,host:os.hostname(),heartbeatAt:new Date().toISOString()}));
 await fs.rename(`${file}.tmp`,file);
}
let stopping = false;
process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
try {
  // One-time migration runs in this worker, never in the web startup path.
  const legacy = process.env.SUNAT_PADRON_LEGACY_DIR;
  if (legacy && path.resolve(legacy) !== path.resolve(directory)) {
    try {
      await fs.access(path.join(directory,"current","manifest.json"));
    } catch {
      try {
        await fs.access(path.join(legacy,"current","manifest.json"));
        const temp = path.join(directory,"migration-current");
        await fs.cp(path.join(legacy,"current"),temp,{recursive:true,preserveTimestamps:true});
        await fs.rename(temp,path.join(directory,"current"));
      } catch(error) { if(error.code!=="ENOENT") console.warn("Padrón migration:",error.message); }
    }
  }
  let next = 0, failures = 0;
  do {
    if (Date.now() >= next) {
      try {
        const result = await ensureSunatPadron({ check: next > 0 });
        if (result.refreshError) throw new Error(result.refreshError);
        await pruneSunatPadronGenerations();
        failures=0;
        // Next check at 03:00 America/Lima (UTC-5, no seasonal offset).
        const tomorrow = new Date();tomorrow.setUTCHours(8,0,0,0);
        if(tomorrow.getTime()<=Date.now())tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
        next=tomorrow.getTime();
        console.log(`Padrón ready; next check ${new Date(next).toISOString()}`);
      } catch(error) {
        failures++;
        next=Date.now()+[60000,300000,900000,3600000][Math.min(failures-1,3)];
        console.error(`Padrón update failed: ${error.message}. Retry ${new Date(next).toISOString()}`);
        if(process.argv.includes("--once"))process.exitCode=1;
      }
    }
    if(Date.now() >= (globalThis.lastWorkerReport || 0)) { await workerState({nextCheckAt:new Date(next).toISOString(),failures}); globalThis.lastWorkerReport=Date.now()+15000; }
    if(process.argv.includes("--once"))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  } while(!stopping);
} finally {await release();}
