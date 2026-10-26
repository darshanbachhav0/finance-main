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

// The development seed builds the demo master data and the four staff accounts. It runs in a child
// process so its storage and backups (fixed at import time) go to a throwaway directory, against a
// throwaway database, offline (no SUNAT endpoint, no reference-rate fallback).
test("development seed completes with the four staff accounts and no demo requests", { timeout: 240000 }, async () => {
  const databaseName = `erp_seed_smoke_${process.pid}_${Date.now()}`;
  const uri = `mongodb://127.0.0.1:${Number(process.env.TEST_MONGODB_PORT || 27017)}/${databaseName}`;
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "uma-seed-smoke-"));
  const env = {
    ...process.env,
    MONGODB_URI: uri,
    UMA_STORAGE_ROOT: storageRoot,
    BACKUP_DIR: path.join(storageRoot, "backups"),
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
  const seedOnce = async () => {
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script], { cwd: backendRoot, env, maxBuffer: 16 * 1024 * 1024 });
    const line = stdout.split(/\r?\n/).find((item) => item.startsWith("SEED_SUMMARY"));
    assert.ok(line, stdout);
    return JSON.parse(line.slice("SEED_SUMMARY".length));
  };
  try {
    const summary = await seedOnce();
    assert.equal(summary.success, true);
    assert.deepEqual(summary.demoAccounts.map((line) => line.split(" ")[0]).sort(), ["10000001", "10000005", "10000006", "10000007"]);
    assert.equal(summary.users, 4);
    assert.equal(summary.requests, 0);
    assert.deepEqual(summary.removedDemoAccounts, []);

    // A separate connection with no models registered, so no auto-index build recreates
    // collections after the drop below.
    connection = await mongoose.createConnection(uri).asPromise();
    const db = connection.db;
    const rates = await db.collection("exchangerates").find({ authoritative: true, providerMode: "SUNAT" }).toArray();
    assert.ok(rates.length > 0 && rates.every((rate) => /^DEMO/.test(rate.sourceLabel)), "demo rates are labelled as demo data");
    // A database seeded by an earlier seed version keeps that version's demo account (another
    // number) as the supplier's preferred one. Seeding again retires it instead of failing on
    // "one active preferred account per currency and type" (E11000).
    const accounts = db.collection("supplierbankaccounts");
    const current = await accounts.findOne({ active: true, preferred: true, currency: "PEN", accountType: "CURRENT" });
    await accounts.updateOne({ _id: current._id }, { $set: { accountNumber: "00119999000200000123" } });
    assert.equal((await seedOnce()).success, true, "the seed runs again over an older seed's data");
    const preferred = await accounts.find({ supplier: current.supplier, currency: "PEN", accountType: "CURRENT", active: true, preferred: true }).toArray();
    assert.deepEqual(preferred.map((account) => account.accountNumber), [current.accountNumber], "the current demo account is the preferred one");
    assert.equal((await accounts.findOne({ accountNumber: "00119999000200000123" })).active, false, "the older one is kept, inactive");

    // A database seeded by an earlier seed version still has a retired demo account (here a
    // requester with a draft request): seeding again removes both.
    const requester = await db.collection("users").insertOne({ name: "Solicitante Ciencias de la Salud (Demo)", email: "demo.solicitante.salud@uma.edu.pe", dni: "10000002", role: "Solicitor", active: true });
    await db.collection("financialrequests").insertOne({ requestNumber: "SOL-2026-30001", requester: requester.insertedId, status: "BORRADOR", developmentScenarioKey: "UMA_01_BORRADOR_SALUD" });
    const rerun = await seedOnce();
    assert.deepEqual(rerun.removedDemoAccounts, ["10000002 Solicitante Ciencias de la Salud (Demo)"]);
    assert.equal(await db.collection("users").countDocuments({ dni: "10000002" }), 0);
    assert.equal(await db.collection("financialrequests").countDocuments(), 0);
    assert.ok(await db.collection("auditlogs").findOne({ action: "DEMO_ACCOUNTS_REMOVED" }), "the removal is audited");
  } finally {
    connection ||= await mongoose.createConnection(uri).asPromise();
    await connection.dropDatabase();
    await connection.close();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
