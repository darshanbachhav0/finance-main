import "dotenv/config";
import mongoose from "mongoose";
import { isMainModule } from "./isMainModule.js";
import { connectDB } from "../config/db.js";
import { syncOfficialExchangeRates } from "../services/exchangeRateSyncService.js";

// Keeps the official SBS USD/PEN rates current with nobody signed in: one synchronization at
// start-up, then every EXCHANGE_RATE_SYNC_MINUTES (default 60). The SBS closes on business days and
// SUNAT publishes the next morning, so an hourly check stores each day's rate within the hour it
// appears, retries a source that is down and raises the out-of-date alert when it stays down.
export function exchangeRateSyncIntervalMs(env = process.env) {
  const minutes = Number(env.EXCHANGE_RATE_SYNC_MINUTES || 60);
  return Math.max(5, Number.isFinite(minutes) ? minutes : 60) * 60 * 1000;
}

export function startExchangeRateWorker({ once = false, env = process.env } = {}) {
  const intervalMs = exchangeRateSyncIntervalMs(env);
  let stopping = false;
  let timer;
  let wake;
  let trigger = "STARTUP";
  console.log(`Exchange-rate worker: official SBS USD/PEN rates every ${Math.round(intervalMs / 60000)} min`);
  const done = (async () => {
    do {
      try {
        const result = await syncOfficialExchangeRates({ trigger });
        console.log(`[EXCHANGE RATES] ${result.run.status}: ${result.inserted} new, ${result.updated} updated, latest ${result.latestDate || "none"}${result.stale ? " (OUT OF DATE)" : ""}`);
      } catch (error) {
        console.error("[EXCHANGE RATES] Synchronization failed", error?.message || error);
        if (once) throw error;
      }
      trigger = "SCHEDULE";
      if (once || stopping) break;
      await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, intervalMs); });
    } while (!stopping);
  })();
  return {
    name: "exchange-rate",
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
  const worker = startExchangeRateWorker({ once: process.argv.includes("--once") });
  const stop = () => { worker.stop(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await worker.done;
  await mongoose.disconnect();
}

if (isMainModule(import.meta.url)) {
  main().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
}
