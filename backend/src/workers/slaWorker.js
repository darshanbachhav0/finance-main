import "dotenv/config";
import mongoose from "mongoose";
import { isMainModule } from "./isMainModule.js";
import { connectDB } from "../config/db.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";
import { checkApprovalSlas } from "../services/slaMonitoringService.js";
import { slaConfiguration } from "../services/slaPolicy.js";

async function ensureIdempotencyIndexes() {
  // Ensure idempotency indexes exist before the first scan, including production with autoIndex disabled.
  await Notification.collection.createIndex({ user: 1, eventKey: 1 }, { unique: true });
  await AuditLog.collection.createIndex({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } }, name: "audit_event_unique" });
}

// Runs the SLA scan loop on an already-open Mongoose connection until stop() is called.
// Safe to run in more than one process: every notification/audit write is keyed by a unique
// eventKey, so a duplicated scan cannot duplicate an escalation.
export function startSlaWorker({ once = false } = {}) {
  const config = slaConfiguration();
  let stopping = false;
  let timer;
  let wake;
  console.log(`SLA worker: every ${config.pollMs}ms; approval SLA ${config.approvalWorkingDays} working day(s); due soon ${config.dueSoonHours}h; escalation to the approver's jefe after ${config.escalationWorkingDays} further working day(s)`);
  const done = (async () => {
    await ensureIdempotencyIndexes();
    do {
      try { console.log("SLA scan", await checkApprovalSlas({ config })); }
      catch (error) { console.error("SLA scan failed", error); if (once) throw error; }
      if (once || stopping) break;
      await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, config.pollMs); });
    } while (!stopping);
  })();
  return {
    name: "sla",
    done,
    async stop() {
      stopping = true;
      clearTimeout(timer);
      wake?.();
      await done.catch(() => {});
    }
  };
}

async function main() {
  await connectDB();
  const worker = startSlaWorker({ once: process.argv.includes("--once") });
  const stop = () => { worker.stop(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await worker.done;
  await mongoose.disconnect();
}

if (isMainModule(import.meta.url)) {
  main().catch(async error => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
}
