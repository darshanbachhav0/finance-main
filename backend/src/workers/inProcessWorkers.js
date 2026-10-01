import { cloudTaxpayerMode } from "../services/taxpayerProfileCache.js";
// Background workers that run inside the web service process.
//
// On Render a persistent disk belongs to exactly one service, so the batch-invoice worker (reads
// uploaded evidence under UMA_STORAGE_ROOT) and the Padrón refresh (writes SUNAT_PADRON_DATA_DIR)
// must run where the web service's disk is mounted. The SLA worker only needs MongoDB but runs
// here too so production has a single, always-on process. Each worker has its own flag so it can
// be switched off (for example when it is hosted separately with the npm worker:* scripts).
function boolFromEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function usesPublicPadron(env = process.env) {
  return ["PADRON", "PUBLIC_PADRON", "PUBLIC-PADRON"].includes(String(env.SUNAT_PROVIDER_MODE || "").trim().toUpperCase());
}

// Defaults: on in production, off elsewhere (development runs batches inline and the workers
// through their npm scripts). The batch worker is never started while inline processing is on,
// and the Padrón refresh only when SUNAT runs in public-Padrón mode.
export function inProcessWorkerFlags(env = process.env) {
  const production = env.NODE_ENV === "production";
  // Same rule as inlineBatchProcessingEnabled() in queues/batchInvoiceQueue.js.
  const inline = boolFromEnv(env.BATCH_INVOICE_INLINE_PROCESSING, !production);
  return {
    batchInvoice: !inline && boolFromEnv(env.BATCH_INVOICE_WORKER_ENABLED, production),
    sla: boolFromEnv(env.SLA_WORKER_ENABLED, production),
    padron: !cloudTaxpayerMode(env) && usesPublicPadron(env) && boolFromEnv(env.SUNAT_PADRON_WORKER_ENABLED, production)
  };
}

// Starts the enabled workers on the already-open Mongoose connection. Returns a stop() that
// waits for in-flight work to finish.
export async function startInProcessWorkers(env = process.env) {
  const flags = inProcessWorkerFlags(env);
  const workers = [];
  if (usesPublicPadron(env) && cloudTaxpayerMode(env)) {
    workers.push((await import("./taxpayerCacheWorker.js")).startTaxpayerCacheWorker());
    console.log("[WORKERS] SUNAT durable taxpayer cache enabled; full Padrón download disabled.");
  }
  if (flags.batchInvoice) workers.push((await import("./batchInvoiceWorker.js")).startBatchInvoiceWorker());
  if (flags.sla) workers.push((await import("./slaWorker.js")).startSlaWorker());
  if (flags.padron) workers.push((await import("./padronWorker.js")).startPadronWorker());
  console.log(`[WORKERS] In-process: batch-invoice=${flags.batchInvoice ? "on" : "off"}, sla=${flags.sla ? "on" : "off"}, sunat-padron=${flags.padron ? "on" : "off"}`);
  return {
    flags,
    workers,
    async stop() {
      await Promise.all(workers.map((worker) => worker.stop().catch((error) => console.error(`Stopping ${worker.name} worker failed`, error))));
    }
  };
}
