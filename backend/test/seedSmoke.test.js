import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import mongoose from "mongoose";

const run = promisify(execFile);
const backendRoot = fileURLToPath(new URL("..", import.meta.url));

test("a required approval step SKIPPED by manager-chain finalization does not leave the route open", async () => {
  const { hasOpenRequiredApprovalStep } = await import("../src/utils/constants.js");
  assert.equal(hasOpenRequiredApprovalStep([{ status: "APPROVED" }, { status: "SKIPPED", required: true }]), false);
  assert.equal(hasOpenRequiredApprovalStep([{ status: "APPROVED" }, { status: "PENDING" }]), true);
  assert.equal(hasOpenRequiredApprovalStep([{ status: "NOT_REACHED", required: true }]), true);
  assert.equal(hasOpenRequiredApprovalStep([{ status: "PENDING", required: false }]), false);
});

// The development seed drives every scenario through the real services, so it breaks whenever a
// business rule changes and the seed is not updated. It runs in a child process so its upload and
// bank-file storage (fixed at import time) goes to a throwaway directory, against a throwaway
// database, offline (no SUNAT endpoint, no reference-rate fallback).
test("development seed completes and builds every demo scenario", { timeout: 240000 }, async () => {
  const databaseName = `erp_seed_smoke_${process.pid}_${Date.now()}`;
  const uri = `mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`;
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "uma-seed-smoke-"));
  const env = {
    ...process.env,
    MONGODB_URI: uri,
    UMA_STORAGE_ROOT: storageRoot,
    SEED_DEMO_PASSWORD: "UMA-Demo-2026!",
    NODE_ENV: "development",
    SUNAT_PROVIDER_MODE: "MOCK",
    BATCH_INVOICE_INLINE_PROCESSING: "false"
  };
  let connection;
  delete env.UPLOAD_DIR;
  delete env.GENERATED_DIR;
  delete env.SUNAT_EXCHANGE_RATE_ENDPOINT;
  delete env.EXCHANGE_RATE_ALLOW_REFERENCE_FALLBACK;
  const script = "import('./src/seed/seed.js').then(async (m) => { const s = await m.seed(); console.log('SEED_SUMMARY' + JSON.stringify(s)); }).finally(() => import('mongoose').then((x) => x.default.disconnect()))";
  try {
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script], { cwd: backendRoot, env, maxBuffer: 16 * 1024 * 1024 });
    const line = stdout.split(/\r?\n/).find((item) => item.startsWith("SEED_SUMMARY"));
    assert.ok(line, stdout);
    const summary = JSON.parse(line.slice("SEED_SUMMARY".length));
    assert.equal(summary.success, true);
    const byKey = Object.fromEntries(summary.scenarios.map((item) => [item.key, item]));
    const expected = {
      UMA_01_BORRADOR_SALUD: "BORRADOR",
      UMA_02_PENDIENTE_DIRECTOR: "PENDIENTE_APROBACION",
      UMA_03_PENDIENTE_VICERRECTOR: "PENDIENTE_APROBACION",
      UMA_04_PENDIENTE_RECTORADO: "PENDIENTE_APROBACION",
      UMA_05_COMPROMISO_PRESUPUESTAL: "COMPROMISO_PRESUPUESTAL",
      UMA_06_CONTABILIZADO: "CONTABILIZADO",
      UMA_07_PROGRAMADO: "PROGRAMADO",
      UMA_08_TXT_SCOTIABANK: "TXT_GENERADO",
      UMA_09_TXT_INTERBANK_USD: "TXT_GENERADO",
      UMA_10_PAGADO_BBVA: "PAGADO",
      UMA_11_CERRADO_BCP: "CERRADO",
      UMA_12_RENDICION_PENDIENTE: "PAGADO",
      UMA_13_RENDICION_CERRADA: "CERRADO",
      UMA_14_REEMBOLSO_NO_DEDUCIBLE: "CONTABILIZADO",
      UMA_15_OBSERVADO: "OBSERVADO",
      UMA_16_RECHAZADO: "RECHAZADO",
      UMA_17_EXCEPCION_PRESUPUESTAL: "OBSERVADO_PRESUPUESTO",
      UMA_18_PERIODO_CERRADO: "BORRADOR",
      UMA_19_VIA_B_CONCILIADO: "CONCILIADO",
      UMA_20_DETRACCION_DEPOSITADA: "PAGADO",
      UMA_21_A2_LOTE_FACTURAS: "CONTABILIZADO"
    };
    assert.equal(summary.scenarios.length, Object.keys(expected).length, JSON.stringify(summary.scenarios));
    for (const [key, status] of Object.entries(expected)) assert.equal(byKey[key]?.status, status, key);
    assert.equal(byKey.UMA_19_VIA_B_CONCILIADO.flowType, "B");
    assert.equal(byKey.UMA_13_RENDICION_CERRADA.flowType, "C");

    // A separate connection with no models registered, so no auto-index build recreates
    // collections after the drop below.
    connection = await mongoose.createConnection(uri).asPromise();
    const db = connection.db;
    const rates = await db.collection("exchangerates").find({ authoritative: true, providerMode: "SUNAT" }).toArray();
    assert.ok(rates.length > 0 && rates.every((rate) => /^DEMO/.test(rate.sourceLabel)), "demo rates are labelled as demo data");
    const batch = await db.collection("massuploadbatches").findOne({});
    assert.equal(batch?.status, "COMPLETED");
    assert.equal(batch?.processedSuccess, 2);
    const detraction = await db.collection("accountspayables").findOne({ "detraction.status": "DEPOSITED" });
    assert.equal(detraction?.status, "PAID");
    // The manager chain finalized above configured rule stages the approvers already hold
    // (recorded SKIPPED); the Purchase Order and the closure must still accept that route.
    const closed = await db.collection("financialrequests").findOne({ developmentScenarioKey: "UMA_11_CERRADO_BCP" });
    assert.ok(closed.purchaseOrder);
    assert.ok(closed.approvalRouteSnapshot.some((step) => step.status === "SKIPPED" && step.required !== false));
  } finally {
    connection ||= await mongoose.createConnection(uri).asPromise();
    await connection.dropDatabase();
    await connection.close();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
