import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensurePadronChunkIndex, findPadronLine } from "../src/services/padronChunkIndex.js";
import { ensureSunatPadron } from "../src/services/sunatPadronService.js";
import { getSupplierPadronPrefill } from "../src/services/supplierPadronLookupService.js";

test("indexed SUNAT lookup and nonblocking proposal prefill", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "uma-padron-lookup-"));
  const originalDir = process.env.SUNAT_PADRON_DATA_DIR;
  const originalRefresh = process.env.SUNAT_PADRON_REFRESH_HOURS;
  const originalStale = process.env.SUNAT_PADRON_MAX_STALE_DAYS;
  const originalFetch = globalThis.fetch;
  const chunks = path.join(directory, "current", "chunks");
  const file = path.join(chunks, "206.txt");
  const manifestFile = path.join(directory, "current", "manifest.json");
  const row = (ruc, name = "COMPAÑÍA ÁRBOL") => `${ruc}|${name}|ACTIVO|HABIDO|150101|AV.|LIMA|-|-|-|-|-|-|-|-`;
  const manifest = { rows: 300, generatedAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString(), chunkPrefixLength: 3 };
  process.env.SUNAT_PADRON_DATA_DIR = directory;
  process.env.SUNAT_PADRON_REFRESH_HOURS = "24";
  process.env.SUNAT_PADRON_MAX_STALE_DAYS = "7";
  globalThis.fetch = async () => { throw new Error("External requests are disabled in this test."); };
  try {
    await fs.mkdir(chunks, { recursive: true });
    // Reverse rows, UTF-8, CRLF and an unterminated final line exercise byte offsets.
    const rows = Array.from({ length: 300 }, (_, i) => row(`206${String(299 - i).padStart(8, "0")}`));
    await fs.writeFile(file, rows.join("\r\n"));
    await fs.writeFile(manifestFile, JSON.stringify(manifest));

    await t.test("finds exact first, middle and final rows regardless of source order", async () => {
      await Promise.all([ensurePadronChunkIndex(file), ensurePadronChunkIndex(file)]);
      for (const index of [0, 127, 128, 299]) {
        assert.equal(await findPadronLine(file, rows[index].slice(0, 11)), rows[index]);
      }
      assert.equal(await findPadronLine(file, "20699999999"), null);
      const stat = await fs.stat(`${file}.ruc-index`);
      assert.equal(stat.size, 32 + rows.length * 8);
    });

    await t.test("rebuilds an outdated index and persists it for subsequent calls", async () => {
      await fs.appendFile(file, `\n${row("20699999998", "NUEVO PROVEEDOR")}`);
      assert.equal(await findPadronLine(file, "20699999998"), row("20699999998", "NUEVO PROVEEDOR"));
      const before = (await fs.stat(`${file}.ruc-index`)).mtimeMs;
      await findPadronLine(file, "20600000000");
      assert.equal((await fs.stat(`${file}.ruc-index`)).mtimeMs, before);
      const restarted = await import(`../src/services/padronChunkIndex.js?restart=${Date.now()}`);
      assert.equal(await restarted.findPadronLine(file, "20699999998"), row("20699999998", "NUEVO PROVEEDOR"));
      assert.equal((await fs.stat(`${file}.ruc-index`)).mtimeMs, before, "A new service instance reuses the on-disk index");
    });

    await t.test("handles UTF-8 records spanning read buffers", async () => {
      const longFile = path.join(chunks, "209.txt");
      const longRow = row("20900000001", "Á".repeat(150000));
      await fs.writeFile(longFile, `${longRow}\n${row("20900000002")}`);
      assert.equal(await findPadronLine(longFile, "20900000001"), longRow);
      assert.equal(await findPadronLine(longFile, "20900000002"), row("20900000002"));
    });

    await t.test("prefills company data and invalidates cached RUCs after a dataset replacement", async () => {
      const first = await getSupplierPadronPrefill("20600000000");
      assert.equal(first.data.legalName, "COMPAÑÍA ÁRBOL");
      assert.equal(first.data.eligibleForHomologation, true);
      await fs.writeFile(file, row("20600000000", "NOMBRE ACTUALIZADO"));
      manifest.generatedAt = new Date(Date.now() + 1000).toISOString();
      await fs.writeFile(manifestFile, JSON.stringify(manifest));
      assert.equal((await getSupplierPadronPrefill("20600000000")).data.legalName, "NOMBRE ACTUALIZADO");
    });

    await t.test("does not wait for an in-progress refresh and refuses expired cached data", async () => {
      manifest.lastCheckedAt = new Date(Date.now() - 2 * 86400000).toISOString();
      await fs.writeFile(manifestFile, JSON.stringify(manifest));
      let release, fetched;
      const gate = new Promise(resolve => { release = resolve; });
      const started = new Promise(resolve => { fetched = resolve; });
      globalThis.fetch = async () => { fetched(); await gate; throw new Error("Test SUNAT offline"); };
      const refresh = ensureSunatPadron();
      try {
        await started;
        const result = await getSupplierPadronPrefill("20600000000");
        assert.equal(result.data.legalName, "NOMBRE ACTUALIZADO", "Local prefill must return while refresh is blocked");
        manifest.lastCheckedAt = new Date(Date.now() - 8 * 86400000).toISOString();
        await fs.writeFile(manifestFile, JSON.stringify(manifest));
        await assert.rejects(getSupplierPadronPrefill("20600000000"), error => error.statusCode === 503);
      } finally {
        release();
        await refresh.catch(() => {});
      }
    });
    await assert.rejects(getSupplierPadronPrefill("123"), error => error.statusCode === 422);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ SUNAT_PADRON_DATA_DIR: originalDir, SUNAT_PADRON_REFRESH_HOURS: originalRefresh, SUNAT_PADRON_MAX_STALE_DAYS: originalStale })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("uma-padron-lookup-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
