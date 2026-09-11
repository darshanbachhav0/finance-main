import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { endianness } from "node:os";

// Each sorted 8-byte entry packs the RUC suffix and its exact UTF-8 byte offset.
// SUNAT rows need not be sorted. The 3-digit chunk prefix leaves an 8-digit suffix.
const MAGIC = "UMARUC02";
const HEADER_BYTES = 32;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const indexes = new Map();
const pending = new Map();
let cacheBytes = 0;

function matches(index, stat) {
  return index?.length >= HEADER_BYTES && index.toString("ascii", 0, 8) === MAGIC &&
    index.readDoubleLE(8) === stat.size && index.readDoubleLE(16) === stat.mtimeMs &&
    index.length === HEADER_BYTES + index.readDoubleLE(24) * 8;
}

async function buildIndex(file, stat) {
  const prefix = path.basename(file, ".txt");
  const parts = [];
  let part = new BigUint64Array(262144), used = 0, count = 0;
  let offset = 0, tail = Buffer.alloc(0);
  function accept(line, bytes) {
    const ruc = line.subarray(0, 11).toString("ascii");
    if (/^\d{11}$/.test(ruc)) {
      if (!ruc.startsWith(prefix)) throw new Error("RUC does not match its Padrón chunk.");
      if (used === part.length) {
        parts.push(part);
        part = new BigUint64Array(262144);
        used = 0;
      }
      part[used++] = (BigInt(ruc.slice(prefix.length)) << 32n) | BigInt(offset);
      count++;
    }
    offset += bytes;
  }
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024 })) {
    const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    let start = 0, end;
    while ((end = data.indexOf(10, start)) !== -1) {
      accept(data.subarray(start, end), end - start + 1);
      start = end + 1;
    }
    tail = Buffer.from(data.subarray(start));
  }
  if (tail.length) accept(tail, tail.length);
  const entries = new BigUint64Array(count);
  let position = 0;
  for (const full of parts) { entries.set(full, position); position += full.length; }
  entries.set(part.subarray(0, used), position);
  entries.sort();
  const after = await fsp.stat(file);
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
    throw new Error("SUNAT Padrón changed while building its search index. Retry the lookup.");
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC);
  header.writeDoubleLE(stat.size, 8);
  header.writeDoubleLE(stat.mtimeMs, 16);
  header.writeDoubleLE(count, 24);
  const bytes = Buffer.from(entries.buffer);
  if (endianness() !== "LE") bytes.swap64();
  const index = Buffer.concat([header, bytes]);
  const indexFile = `${file}.ruc-index`;
  const temporary = `${indexFile}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(temporary, index);
    await fsp.rename(temporary, indexFile);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
  return index;
}

export async function ensurePadronChunkIndex(file) {
  const stat = await fsp.stat(file);
  // Retain correct streaming lookup for unsupported future chunk sizes/formats.
  if (stat.size >= 2 ** 32 || !/^\d{3,10}\.txt$/.test(path.basename(file))) return null;
  const key = `${path.resolve(file)}:${stat.size}:${stat.mtimeMs}`;
  if (indexes.has(key)) return indexes.get(key);
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      let index;
      try { index = await fsp.readFile(`${file}.ruc-index`); } catch { /* Build once. */ }
      if (!matches(index, stat)) index = await buildIndex(file, stat);
      while (indexes.size && cacheBytes + index.length > MAX_CACHE_BYTES) {
        const oldest = indexes.keys().next().value;
        cacheBytes -= indexes.get(oldest).length;
        indexes.delete(oldest);
      }
      if (index.length <= MAX_CACHE_BYTES) {
        indexes.set(key, index);
        cacheBytes += index.length;
      }
      return index;
    })().finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

export async function findPadronLine(file, ruc) {
  const index = await ensurePadronChunkIndex(file);
  let start = 0;
  if (index) {
    const prefix = path.basename(file, ".txt");
    if (!ruc.startsWith(prefix)) return null;
    const target = BigInt(ruc.slice(prefix.length));
    let low = 0, high = index.readDoubleLE(24);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const value = index.readBigUInt64LE(HEADER_BYTES + mid * 8) >> 32n;
      if (value < target) low = mid + 1;
      else high = mid;
    }
    if (low === index.readDoubleLE(24)) return null;
    const entry = index.readBigUInt64LE(HEADER_BYTES + low * 8);
    if ((entry >> 32n) !== target) return null;
    start = Number(entry & 0xffffffffn);
  }
  const input = fs.createReadStream(file, { start, encoding: "utf8", highWaterMark: 4096 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.slice(0, 11) === ruc) return line;
      if (index) throw new Error("SUNAT Padrón changed during lookup. Retry the lookup.");
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return null;
}

export async function preparePadronIndexes(chunksDir) {
  let count = 0;
  for (const file of await fsp.readdir(chunksDir)) {
    if (!/^\d+\.txt$/.test(file)) continue;
    await ensurePadronChunkIndex(path.join(chunksDir, file));
    count++;
  }
  return count;
}

