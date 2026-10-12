import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inProcessWorkerFlags } from "../src/workers/inProcessWorkers.js";
import { runPadronWorker } from "../src/workers/padronWorker.js";

test("in-process workers default on in production and can each be switched off", () => {
  const production = { NODE_ENV: "production", SUNAT_PROVIDER_MODE: "PADRON" };
  assert.deepEqual(inProcessWorkerFlags(production), { batchInvoice: true, sla: true, padron: true, notificationEmail: false });
  assert.deepEqual(inProcessWorkerFlags({ NODE_ENV: "development", SUNAT_PROVIDER_MODE: "PADRON" }), { batchInvoice: false, sla: false, padron: false, notificationEmail: false });
  assert.equal(inProcessWorkerFlags({ ...production, BATCH_INVOICE_WORKER_ENABLED: "false" }).batchInvoice, false);
  assert.equal(inProcessWorkerFlags({ ...production, SLA_WORKER_ENABLED: "0" }).sla, false);
  assert.equal(inProcessWorkerFlags({ ...production, SUNAT_PADRON_WORKER_ENABLED: "off" }).padron, false);
  // The notification-email sender only runs once emails are switched on.
  assert.equal(inProcessWorkerFlags({ ...production, NOTIFICATION_EMAIL_MODE: "SMTP" }).notificationEmail, true);
  assert.equal(inProcessWorkerFlags({ ...production, NOTIFICATION_EMAIL_MODE: "OFF" }).notificationEmail, false);
  assert.equal(inProcessWorkerFlags({ ...production, NOTIFICATION_EMAIL_MODE: "SMTP", NOTIFICATION_EMAIL_WORKER_ENABLED: "false" }).notificationEmail, false);
  assert.equal(inProcessWorkerFlags({ NODE_ENV: "development", NOTIFICATION_EMAIL_MODE: "LOG", NOTIFICATION_EMAIL_WORKER_ENABLED: "true" }).notificationEmail, true);
  // Inline processing (a dev convenience) and the durable worker never run together.
  assert.equal(inProcessWorkerFlags({ ...production, BATCH_INVOICE_INLINE_PROCESSING: "true" }).batchInvoice, false);
  // The Padrón refresh only matters in public-Padrón mode.
  assert.equal(inProcessWorkerFlags({ NODE_ENV: "production", SUNAT_PROVIDER_MODE: "MOCK" }).padron, false);
  // Explicit opt-in outside production (the demo launcher sets these).
  assert.deepEqual(inProcessWorkerFlags({ NODE_ENV: "development", BATCH_INVOICE_INLINE_PROCESSING: "false", BATCH_INVOICE_WORKER_ENABLED: "true", SLA_WORKER_ENABLED: "true" }), { batchInvoice: true, sla: true, padron: false, notificationEmail: false });
});

test("worker modules do not start on import and render.yaml runs them inside the web service", async () => {
  const batch = await import("../src/workers/batchInvoiceWorker.js");
  const sla = await import("../src/workers/slaWorker.js");
  assert.equal(typeof batch.startBatchInvoiceWorker, "function");
  assert.equal(typeof sla.startSlaWorker, "function");
  const render = await fs.readFile(new URL("../../render.yaml", import.meta.url), "utf8");
  assert.equal(/type:\s*worker/.test(render), false, "no separate Render worker services (disks are per-service)");
  assert.equal((render.match(/^\s*- type: web/gm) || []).length, 1);
  for (const flag of ["BATCH_INVOICE_WORKER_ENABLED", "SLA_WORKER_ENABLED", "SUNAT_PADRON_WORKER_ENABLED", "UMA_STORAGE_ROOT", "SUNAT_PADRON_DATA_DIR"]) {
    assert.match(render, new RegExp(`key: ${flag}\\b`));
  }
  const server = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /startInProcessWorkers\(\)/);
});

test("Padrón worker respects a live lease held by another instance", { timeout: 20000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uma-padron-lock-"));
  const original = process.env.SUNAT_PADRON_DATA_DIR;
  process.env.SUNAT_PADRON_DATA_DIR = dir;
  try {
    const lock = path.join(dir, "worker.lock");
    await fs.writeFile(lock, JSON.stringify({ pid: 1, host: "another-render-instance" }));
    const result = await runPadronWorker({ once: true });
    assert.deepEqual(result, { ran: false, failed: false });
    assert.equal(JSON.parse(await fs.readFile(lock, "utf8")).host, "another-render-instance", "a fresh foreign lease is left untouched");
  } finally {
    if (original === undefined) delete process.env.SUNAT_PADRON_DATA_DIR; else process.env.SUNAT_PADRON_DATA_DIR = original;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
