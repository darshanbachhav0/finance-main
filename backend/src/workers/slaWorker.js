import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";
import { checkApprovalSlas } from "../services/slaMonitoringService.js";
import { slaConfiguration } from "../services/slaPolicy.js";

async function main() {
  const config = slaConfiguration();
  await connectDB();
  // Ensure idempotency indexes exist before the first scan, including production with autoIndex disabled.
  await Notification.collection.createIndex({ user: 1, eventKey: 1 }, { unique: true });
  await AuditLog.collection.createIndex({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } }, name: "audit_event_unique" });
  let stopping = false;
  let timer;
  let wake;
  const stop = () => { stopping = true; clearTimeout(timer); wake?.(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(`SLA worker: every ${config.pollMs}ms; due soon ${config.dueSoonHours}h; escalation ${config.escalationHours}h overdue`);
  do {
    try { console.log("SLA scan", await checkApprovalSlas({ config })); }
    catch (error) { console.error("SLA scan failed", error); if (process.argv.includes("--once")) throw error; }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, config.pollMs); });
  } while (!stopping);
  await mongoose.disconnect();
}
main().catch(async error => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
