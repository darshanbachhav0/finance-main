import fs from "node:fs";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { openZipEntryStream } from "../utils/zipReader.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { findPadronLine, preparePadronIndexes } from "./padronChunkIndex.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_DOWNLOAD_URL =
  "https://www2.sunat.gob.pe/padron_reducido_ruc.zip";

const DEFAULT_INFO_URL =
  "https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html";

const DEFAULT_REFRESH_HOURS = 24;
const DEFAULT_MAX_STALE_DAYS = 7;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_LOCK_WAIT_MS = 15 * 60_000;
const DEFAULT_STALE_LOCK_MS = 30 * 60_000;

const CHUNK_PREFIX_LENGTH = 3;

const memoryCache = new Map();
const MAX_MEMORY_CACHE = 5_000;

let refreshTimer = null;
let inProcessSyncPromise = null;
let nextLookupRefreshAt = 0;

function env(name, fallback = "") {
  return String(
    process.env[name] ?? fallback
  ).trim();
}

function positiveNumber(
  value,
  fallback
) {
  const parsed = Number(value);

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function baseDir() {
  const configured = env(
    "SUNAT_PADRON_DATA_DIR"
  );

  return configured
    ? path.resolve(configured)
    : path.resolve(
        BACKEND_ROOT,
        "data",
        "sunat-padron"
      );
}

function currentDir() {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(baseDir(), "active.json"), "utf8"));
    if (/^next-[0-9]+-[0-9]+$/.test(pointer.directory)) return path.join(baseDir(), pointer.directory);
  } catch {}
  const local = path.join(baseDir(), "current");
  const legacy = process.env.SUNAT_PADRON_LEGACY_DIR;
  return !fs.existsSync(path.join(local, "manifest.json")) && legacy ? path.join(path.resolve(legacy), "current") : local;
}

async function syncStatus(update) {
  let previous = {};
  try { previous = JSON.parse(await fsp.readFile(path.join(baseDir(), "sync-status.json"), "utf8")); } catch {}
  await writeJson(path.join(baseDir(), "sync-status.json"), { ...previous, ...update, updatedAt: nowIso() });
}

function currentChunksDir() {
  return path.join(
    currentDir(),
    "chunks"
  );
}

function manifestPath() {
  return path.join(
    currentDir(),
    "manifest.json"
  );
}

function downloadPath() {
  return path.join(
    baseDir(),
    "padron_reducido_ruc.zip"
  );
}

function lockPath() {
  return path.join(
    baseDir(),
    "sync.lock"
  );
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function normalizedRuc(value) {
  return String(
    value ?? ""
  ).replace(/\D/g, "");
}

function normalizeText(value) {
  return String(
    value ?? ""
  )
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUpper(value) {
  return normalizeText(
    value
  ).toUpperCase();
}

function parseDatasetDateFromHtml(
  html
) {
  const match = String(
    html || ""
  ).match(
    /Actualizado\s+al\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i
  );

  if (!match) {
    return "";
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parsePadronLine(line) {
  const columns = String(
    line || ""
  )
    .replace(/\r$/, "")
    .split("|");

  const ruc =
    normalizedRuc(
      columns[0]
    );

  if (!/^\d{11}$/.test(ruc)) {
    return null;
  }

  const fields = {
    ruc,

    legalName:
      normalizeText(
        columns[1]
      ),

    taxpayerStatus:
      normalizeUpper(
        columns[2]
      ),

    domicileCondition:
      normalizeUpper(
        columns[3]
      ),

    ubigeo:
      normalizeText(
        columns[4]
      ),

    roadType:
      normalizeText(
        columns[5]
      ),

    roadName:
      normalizeText(
        columns[6]
      ),

    zoneCode:
      normalizeText(
        columns[7]
      ),

    zoneType:
      normalizeText(
        columns[8]
      ),

    number:
      normalizeText(
        columns[9]
      ),

    interior:
      normalizeText(
        columns[10]
      ),

    lot:
      normalizeText(
        columns[11]
      ),

    department:
      normalizeText(
        columns[12]
      ),

    block:
      normalizeText(
        columns[13]
      ),

    kilometer:
      normalizeText(
        columns[14]
      )
  };

  const addressParts = [
    fields.roadType,
    fields.roadName,

    fields.number &&
    fields.number !== "-"
      ? `NRO. ${fields.number}`
      : "",

    fields.interior &&
    fields.interior !== "-"
      ? `INT. ${fields.interior}`
      : "",

    fields.lot &&
    fields.lot !== "-"
      ? `LOTE ${fields.lot}`
      : "",

    fields.block &&
    fields.block !== "-"
      ? `MZA. ${fields.block}`
      : "",

    fields.department &&
    fields.department !== "-"
      ? `DPTO. ${fields.department}`
      : "",

    fields.kilometer &&
    fields.kilometer !== "-"
      ? `KM. ${fields.kilometer}`
      : ""
  ]
    .map((part) =>
      normalizeText(part)
    )
    .filter(
      (part) =>
        part &&
        part !== "-"
    );

  return {
    ...fields,

    fiscalAddress:
      addressParts
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
  };
}

async function readManifest() {
  try {
    const directory = currentDir();
    const manifest = JSON.parse(await fsp.readFile(path.join(directory, "manifest.json"), "utf8"));
    Object.defineProperty(manifest, "localDirectory", { value: directory });
    return manifest;
  } catch { return null; }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, filePath);
}

function ageMs(value) {
  const time =
    new Date(
      value || 0
    ).getTime();

  return Number.isFinite(time)
    ? Math.max(
        0,
        Date.now() - time
      )
    : Number.POSITIVE_INFINITY;
}

function refreshHours() {
  return positiveNumber(
    env(
      "SUNAT_PADRON_REFRESH_HOURS"
    ),
    DEFAULT_REFRESH_HOURS
  );
}

function maxStaleDays() {
  return positiveNumber(
    env(
      "SUNAT_PADRON_MAX_STALE_DAYS"
    ),
    DEFAULT_MAX_STALE_DAYS
  );
}

function requestTimeoutMs() {
  return positiveNumber(
    env(
      "SUNAT_PADRON_REQUEST_TIMEOUT_MS"
    ),
    DEFAULT_REQUEST_TIMEOUT_MS
  );
}

function isFresh(manifest) {
  return (
    Boolean(
      manifest?.generatedAt
    ) &&
    ageMs(
      manifest.lastCheckedAt ||
        manifest.generatedAt
    ) <
      refreshHours() *
        60 *
        60 *
        1000
  );
}

function isAcceptablyStale(
  manifest
) {
  return (
    Boolean(
      manifest?.generatedAt
    ) &&
    ageMs(
      manifest.lastCheckedAt ||
        manifest.generatedAt
    ) <=
      maxStaleDays() *
        24 *
        60 *
        60 *
        1000
  );
}

function datasetExists(manifest) {
  const chunks = path.join(manifest?.localDirectory || currentDir(), "chunks");
  if (!(manifest?.rows > 0) || !fs.existsSync(chunks)) return false;
  if (manifest.chunkFiles) return manifest.chunkFiles.every(file => /^\d{3}\.txt$/.test(file) && fs.existsSync(path.join(chunks, file)) && fs.existsSync(path.join(chunks, `${file}.ruc-index`)));
  return fs.readdirSync(chunks).some(file => /^\d{3}\.txt$/.test(file));
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs =
    requestTimeoutMs()
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal,

        redirect: "follow"
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDatasetDate() {
  try {
    const response =
      await fetchWithTimeout(
        env(
          "SUNAT_PADRON_INFO_URL",
          DEFAULT_INFO_URL
        ),
        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml"
          }
        },
        Math.min(
          requestTimeoutMs(),
          30_000
        )
      );

    if (!response.ok) {
      return "";
    }

    return parseDatasetDateFromHtml(
      await response.text()
    );
  } catch {
    return "";
  }
}

async function downloadPadronZip({
  previousManifest,
  force = false
} = {}) {
  const url = env(
    "SUNAT_PADRON_DOWNLOAD_URL",
    DEFAULT_DOWNLOAD_URL
  );

  const datasetDate =
    await fetchDatasetDate();

  if (
    !force &&
    datasetDate &&
    previousManifest?.datasetDate ===
      datasetDate &&
    datasetExists(
      previousManifest
    )
  ) {
    return {
      changed: false,
      datasetDate,
      reason:
        "dataset-date-unchanged"
    };
  }

  const headers = {
    Accept:
      "application/zip,application/octet-stream"
  };

  if (
    !force &&
    previousManifest?.sourceEtag
  ) {
    headers["If-None-Match"] =
      previousManifest.sourceEtag;
  }

  if (
    !force &&
    previousManifest?.sourceLastModified
  ) {
    headers[
      "If-Modified-Since"
    ] =
      previousManifest.sourceLastModified;
  }

  let response;

  try {
    response =
      await fetchWithTimeout(
        url,
        {
          headers
        }
      );
  } catch (error) {
    const message =
      error?.name ===
      "AbortError"
        ? "SUNAT Padrón download timed out."
        : "SUNAT Padrón download could not be reached.";

    throw new AppError(
      503,
      message,
      {
        url,
        reason:
          error?.message
      },
      ERROR_CODES
        .INTEGRATION_NOT_CONFIGURED
    );
  }

  if (
    response.status === 304 &&
    previousManifest &&
    datasetExists(
      previousManifest
    )
  ) {
    return {
      changed: false,

      datasetDate:
        datasetDate ||
        previousManifest.datasetDate,

      reason:
        "not-modified"
    };
  }

  if (
    !response.ok ||
    !response.body
  ) {
    throw new AppError(
      503,
      "SUNAT Padrón download returned an unsuccessful response.",
      {
        url,
        status:
          response.status
      },
      ERROR_CODES
        .INTEGRATION_NOT_CONFIGURED
    );
  }

  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();

  if (
    contentType &&
    !contentType.includes(
      "zip"
    ) &&
    !contentType.includes(
      "octet-stream"
    )
  ) {
    throw new AppError(
      502,
      "SUNAT Padrón download did not return a ZIP file.",
      {
        url,
        contentType
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  const target =
    downloadPath();

  const temp =
    `${target}.part`;

  await fsp.mkdir(
    baseDir(),
    {
      recursive: true
    }
  );

  await fsp.rm(
    temp,
    {
      force: true
    }
  );

  const checksum = createHash("sha256");
  const hashing = new Transform({ transform(chunk, _encoding, callback) { checksum.update(chunk); callback(null, chunk); } });
  await syncStatus({ phase: "DOWNLOADING", rows: 0 });
  await pipeline(
    Readable.fromWeb(
      response.body
    ),
    hashing,
    fs.createWriteStream(temp),
    { signal: AbortSignal.timeout(positiveNumber(env("SUNAT_PADRON_DOWNLOAD_TIMEOUT_MS"), 15 * 60_000)) }
  );

  const stat = await fsp.stat(temp);
  const sha256 = checksum.digest("hex");
  if (!force && previousManifest?.sha256 === sha256 && datasetExists(previousManifest)) {
    await fsp.unlink(temp);
    return { changed: false, datasetDate, reason: "checksum-unchanged" };
  }

  const minimumZipBytes =
    positiveNumber(
      env(
        "SUNAT_PADRON_MIN_ZIP_BYTES"
      ),
      100_000
    );

  if (
    stat.size <
    minimumZipBytes
  ) {
    await fsp.rm(
      temp,
      {
        force: true
      }
    );

    throw new AppError(
      502,
      "SUNAT Padrón ZIP is unexpectedly small.",
      {
        bytes:
          stat.size,

        minimumZipBytes
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  await fsp.rm(
    target,
    {
      force: true
    }
  );

  await fsp.rename(
    temp,
    target
  );

  return {
    changed: true,
    sha256,
    datasetDate,
    url,

    bytes:
      stat.size,

    etag:
      response.headers.get(
        "etag"
      ) || "",

    lastModified:
      response.headers.get(
        "last-modified"
      ) || "",

    contentLength:
      response.headers.get(
        "content-length"
      ) || ""
  };
}

async function closeWriteStream(
  stream
) {
  if (!stream) {
    return;
  }

  await new Promise(
    (resolve, reject) => {
      stream.once(
        "error",
        reject
      );

      stream.end(resolve);
    }
  );
}

async function buildChunksFromZip({
  zipPath,
  stagingDir,
  datasetDate,
  downloadMeta
}) {
  await fsp.rm(
    stagingDir,
    {
      recursive: true,
      force: true
    }
  );

  const chunksDir =
    path.join(
      stagingDir,
      "chunks"
    );

  await fsp.mkdir(
    chunksDir,
    {
      recursive: true
    }
  );

  const {
    entryName,
    stream,
    header
  } =
    await openZipEntryStream(
      zipPath,
      {
        predicate:
          (entry) =>
            !entry.isDirectory &&
            /\.txt$/i.test(
              entry.entryName
            ),

        maxUncompressedBytes:
          positiveNumber(
            env(
              "SUNAT_PADRON_MAX_UNCOMPRESSED_BYTES"
            ),
            5 *
              1024 *
              1024 *
              1024
          )
      }
    );

  stream.setEncoding(
    "latin1"
  );

  const lines =
    readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

  let rowCount = 0;
  let skipped = 0;
  let headerLine = "";
  let currentPrefix = "";
  let currentStream = null;
  let batch = "";
  async function flushBatch() {
    if (!batch) return;
    const data = batch; batch = "";
    await new Promise((resolve, reject) => currentStream.write(data, "utf8", error => error ? reject(error) : resolve()));
  }

  try {
    for await (
      const rawLine of lines
    ) {
      const line =
        String(
          rawLine || ""
        )
          .replace(
            /^(?:\uFEFF|ï»¿)/,
            ""
          )
          .trimEnd();

      if (!line) {
        continue;
      }

      if (!headerLine) {
        headerLine = line;

        const firstColumn =
          normalizeUpper(
            line.split("|")[0]
          );

        if (
          firstColumn.includes(
            "RUC"
          ) &&
          !/^\d{11}$/.test(
            firstColumn
          )
        ) {
          continue;
        }
      }

      const ruc = line.slice(0, 11);
      if (!/^\d{11}$/.test(ruc) || line[11] !== "|") {
        skipped += 1;
        continue;
      }

      const prefix =
        ruc.slice(
          0,
          CHUNK_PREFIX_LENGTH
        );

      if (
        prefix !==
        currentPrefix
      ) {
        await flushBatch();
        await closeWriteStream(currentStream);

        currentPrefix =
          prefix;

        currentStream =
          fs.createWriteStream(
            path.join(
              chunksDir,
              `${prefix}.txt`
            ),
            {
              flags: "a",
              encoding: "utf8"
            }
          );
      }

      batch += `${line}\n`;
      if (batch.length >= 256 * 1024) await flushBatch();

      rowCount += 1;

      if (
        rowCount %
          500_000 ===
        0
      ) {
        await syncStatus({ phase: "INDEXING", rows: rowCount });
        console.log(
          `[SUNAT PADRON] Indexed ${rowCount.toLocaleString(
            "en-US"
          )} RUC rows...`
        );
      }
    }
  } finally {
    await flushBatch();
    await closeWriteStream(currentStream);

    lines.close();
  }

  if (rowCount === 0) {
    throw new AppError(
      502,
      "SUNAT Padrón ZIP did not contain usable RUC rows.",
      {
        entryName,
        skipped
      },
      ERROR_CODES
        .VALIDATION_ERROR
    );
  }

  const previous = await readManifest();
  const minimumRows = positiveNumber(env("SUNAT_PADRON_MIN_ROWS"), 100000);
  const minimumRatio = positiveNumber(env("SUNAT_PADRON_MIN_ROW_RATIO"), 0.8);
  if (rowCount < minimumRows || (previous?.rows && rowCount < previous.rows * minimumRatio)) {
    throw new Error("SUNAT dataset contains unexpectedly few records; active data was preserved.");
  }

  // Prepare exact byte-offset indexes before publishing a new dataset.
  await syncStatus({ phase: "BUILDING_SEARCH_INDEX", rows: rowCount });
  await preparePadronIndexes(chunksDir);

  const manifest = {
    sha256: downloadMeta?.sha256,
    chunkFiles: (await fsp.readdir(chunksDir)).filter(file => /^\d{3}\.txt$/.test(file)),
    provider:
      "SUNAT_PUBLIC_PADRON_RUC",

    officialSource: true,

    sourcePage:
      env(
        "SUNAT_PADRON_INFO_URL",
        DEFAULT_INFO_URL
      ),

    sourceUrl:
      env(
        "SUNAT_PADRON_DOWNLOAD_URL",
        DEFAULT_DOWNLOAD_URL
      ),

    sourceEntry:
      entryName,

    datasetDate:
      datasetDate || "",

    sourceEtag:
      downloadMeta?.etag ||
      "",

    sourceLastModified:
      downloadMeta
        ?.lastModified ||
      "",

    zipBytes:
      downloadMeta?.bytes ||
      0,

    uncompressedBytes:
      header?.size || 0,

    rows:
      rowCount,

    skippedRows:
      skipped,

    chunkPrefixLength:
      CHUNK_PREFIX_LENGTH,

    sourceEncoding:
      "ISO-8859-1",

    storedEncoding:
      "UTF-8",

    generatedAt:
      nowIso(),

    lastCheckedAt:
      nowIso(),

    limitation:
      "This dataset validates taxpayer RUC/status/condition. It does not validate existence or acceptance of a specific electronic voucher (CPE)."
  };

  await writeJson(
    path.join(
      stagingDir,
      "manifest.json"
    ),
    manifest
  );

  return manifest;
}

async function activateStaging(stagingDir) {
  // Readers retain the generation they opened. Publishing changes only a small pointer.
  const manifest = JSON.parse(await fsp.readFile(path.join(stagingDir, "manifest.json"), "utf8"));
  if (!manifest.rows || !manifest.chunkFiles?.length) throw new Error("Incomplete Padr�n generation");
  for (const file of manifest.chunkFiles) {
    if (!(await fsp.stat(path.join(stagingDir, "chunks", `${file}.ruc-index`))).size) throw new Error("Missing RUC index");
  }
  await writeJson(path.join(baseDir(), "active.json"), { directory: path.basename(stagingDir), activatedAt: nowIso() });
}

async function touchManifest(
  manifest,
  updates = {}
) {
  if (!manifest) {
    return null;
  }

  const next = {
    ...manifest,
    ...updates,

    lastCheckedAt:
      nowIso()
  };

  await writeJson(
    manifestPath(),
    next
  );

  return next;
}

async function lockIsStale() {
  try {
    const stat =
      await fsp.stat(
        lockPath()
      );

    return (
      Date.now() -
        stat.mtimeMs >
      DEFAULT_STALE_LOCK_MS
    );
  } catch {
    return false;
  }
}

async function acquireCrossProcessLock() {
  await fsp.mkdir(
    baseDir(),
    {
      recursive: true
    }
  );

  const started =
    Date.now();

  while (true) {
    try {
      const handle =
        await fsp.open(
          lockPath(),
          "wx"
        );

      await handle.writeFile(
        JSON.stringify({
          pid:
            process.pid,

          createdAt:
            nowIso()
        })
      );

      return handle;
    } catch (error) {
      if (
        error?.code !==
        "EEXIST"
      ) {
        throw error;
      }

      if (
        await lockIsStale()
      ) {
        await fsp.rm(
          lockPath(),
          {
            force: true
          }
        );

        continue;
      }

      if (
        Date.now() -
          started >
        DEFAULT_LOCK_WAIT_MS
      ) {
        throw new AppError(
          503,
          "Timed out waiting for another SUNAT Padrón synchronization to finish.",
          {
            lock:
              lockPath()
          },
          ERROR_CODES
            .INTEGRATION_NOT_CONFIGURED
        );
      }

      await sleep(
        2_000
      );
    }
  }
}

async function releaseCrossProcessLock(
  handle
) {
  try {
    await handle?.close();
  } finally {
    await fsp.rm(
      lockPath(),
      {
        force: true
      }
    );
  }
}

async function syncInternal({
  force = false,
  check = false
} = {}) {
  const before =
    await readManifest();

  if (
    !force && !check &&
    datasetExists(before) &&
    isFresh(before)
  ) {
    return {
      ...before,
      changed: false,
      cached: true
    };
  }

  const lockHandle = await acquireCrossProcessLock();
  const heartbeat = setInterval(() => { const now = new Date(); void lockHandle.utimes(now, now).catch(() => {}); }, 30000);
  heartbeat.unref();

  try {
    const current =
      await readManifest();

    if (
      !force && !check &&
      datasetExists(
        current
      ) &&
      isFresh(current)
    ) {
      return {
        ...current,
        changed: false,
        cached: true
      };
    }

    console.log(
      "[SUNAT PADRON] Checking official public Padrón Reducido..."
    );

    let downloadMeta;
    if (!force) {
      try {
        const pending = JSON.parse(await fsp.readFile(path.join(baseDir(), "download-meta.json"), "utf8"));
        if (Date.now() - new Date(pending.savedAt).getTime() < 86400000) {
          const hash = createHash("sha256");
          for await (const chunk of fs.createReadStream(downloadPath())) hash.update(chunk);
          if (hash.digest("hex") === pending.sha256) downloadMeta = pending;
        }
      } catch {}
    }
    downloadMeta ||= await downloadPadronZip({ previousManifest: current, force });
    if (downloadMeta.changed) await writeJson(path.join(baseDir(), "download-meta.json"), { ...downloadMeta, savedAt: nowIso() });

    if (
      !downloadMeta.changed &&
      datasetExists(
        current
      )
    ) {
      const updated =
        await touchManifest(
          current,
          {
            datasetDate:
              downloadMeta
                .datasetDate ||
              current.datasetDate
          }
        );

      await syncStatus({ phase: "READY", lastSuccessAt: nowIso(), changed: false, error: null });
      console.log(
        `[SUNAT PADRON] Dataset is current${
          updated?.datasetDate
            ? ` (${updated.datasetDate})`
            : ""
        }.`
      );

      return {
        ...updated,
        changed: false,
        cached: true
      };
    }

    console.log(
      "[SUNAT PADRON] Download complete. Building local RUC index..."
    );

    const stagingDir =
      path.join(
        baseDir(),
        `next-${Date.now()}-${process.pid}`
      );

    const manifest =
      await buildChunksFromZip({
        zipPath:
          downloadPath(),

        stagingDir,

        datasetDate:
          downloadMeta
            .datasetDate,

        downloadMeta
      });

    await activateStaging(
      stagingDir
    );

    await syncStatus({ phase: "READY", lastSuccessAt: nowIso(), changed: true, rows: manifest.rows, error: null });
    await fsp.unlink(path.join(baseDir(), "download-meta.json")).catch(() => {});
    memoryCache.clear();

    console.log(
      `[SUNAT PADRON] Ready: ${manifest.rows.toLocaleString(
        "en-US"
      )} RUC rows${
        manifest.datasetDate
          ? `, dataset ${manifest.datasetDate}`
          : ""
      }.`
    );

    return {
      ...manifest,
      changed: true,
      cached: false
    };
  } catch (error) {
    await syncStatus({ phase: "FAILED", error: error.message, failedAt: nowIso() });
    const fallback =
      await readManifest();

    if (
      datasetExists(
        fallback
      ) &&
      isAcceptablyStale(
        fallback
      )
    ) {
      console.warn(
        `[SUNAT PADRON] Refresh failed; using cached dataset from ${
          fallback.datasetDate ||
          fallback.generatedAt
        }. ${error.message}`
      );

      return {
        ...fallback,

        changed: false,

        cached: true,

        staleFallback: true,

        refreshError:
          error.message
      };
    }

    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseCrossProcessLock(
      lockHandle
    );
  }
}

export async function ensureSunatPadron(
  options = {}
) {
  if (
    !inProcessSyncPromise
  ) {
    inProcessSyncPromise =
      syncInternal(
        options
      ).finally(() => {
        inProcessSyncPromise =
          null;
      });
  }

  return inProcessSyncPromise;
}

export async function forceSyncSunatPadron() {
  return ensureSunatPadron({
    force: true
  });
}

function cachePut(
  ruc,
  value
) {
  if (
    memoryCache.has(ruc)
  ) {
    memoryCache.delete(
      ruc
    );
  }

  memoryCache.set(
    ruc,
    value
  );

  if (
    memoryCache.size >
    MAX_MEMORY_CACHE
  ) {
    const oldest =
      memoryCache
        .keys()
        .next().value;

    memoryCache.delete(
      oldest
    );
  }
}

function refreshForLookup() {
  if (Date.now() < nextLookupRefreshAt) return;
  nextLookupRefreshAt = Date.now() + 5 * 60_000;
  void ensureSunatPadron().catch(error => {
    console.warn("[SUNAT PADRON] Background lookup refresh failed:", error.message);
  });
}

export async function lookupSunatPadronRuc(
  identifier,
  { localOnly = false } = {}
) {
  const ruc =
    normalizedRuc(
      identifier
    );

  if (
    !/^\d{11}$/.test(
      ruc
    )
  ) {
    return {
      found: false,
      ruc,

      reason:
        "RUC_MUST_HAVE_11_DIGITS"
    };
  }

  // Proposal prefill must never wait for a full dataset refresh or its process lock.
  // Financial validation retains its existing refresh/fallback policy.
  const manifest = await readManifest();

  if (
    !datasetExists(
      manifest
    ) || (!isFresh(manifest) && !isAcceptablyStale(manifest))
  ) {
    throw new AppError(
      503,
      "SUNAT public Padrón is being prepared or refreshed. You can complete the proposal manually; taxpayer validation remains required.",
      undefined,
      ERROR_CODES
        .INTEGRATION_NOT_CONFIGURED
    );
  }

  // Check the dataset generation before returning cached records, including after
  // an external sync process has replaced the files or the dataset has expired.
  const cacheKey = `${manifest.localDirectory}:${manifest.generatedAt}:${ruc}`;
  if (memoryCache.has(cacheKey)) return { ...memoryCache.get(cacheKey), manifest };

  const chunkFile =
    path.join(
      path.join(manifest.localDirectory, "chunks"),
      `${ruc.slice(
        0,
        manifest.chunkPrefixLength || CHUNK_PREFIX_LENGTH
      )}.txt`
    );

  if (
    !fs.existsSync(
      chunkFile
    )
  ) {
    const result = {
      found: false,
      ruc,
      manifest
    };

    cachePut(
      cacheKey,
      result
    );

    return result;
  }

  const line = await findPadronLine(chunkFile, ruc);
  const record = line ? parsePadronLine(line) : null;
  const result = {
    found: Boolean(record),
    ruc,
    record,
    manifest
  };

  cachePut(
    cacheKey,
    result
  );

  return result;
}

export async function getSunatPadronStatus() {
  const manifest =
    await readManifest();

  let synchronization = {};
  try { synchronization = JSON.parse(await fsp.readFile(path.join(baseDir(), "sync-status.json"), "utf8")); } catch {}
  let worker = {};
  try { worker = JSON.parse(await fsp.readFile(path.join(baseDir(), "worker-state.json"), "utf8")); } catch {}
  try {
    const stat = await fsp.stat(path.join(baseDir(), "worker.lock"));
    worker.running = Date.now() - stat.mtimeMs < 60000;
  } catch { worker.running = false; }
  return {
    worker,
    synchronization,
    configured: true,

    ready:
      datasetExists(
        manifest
      ),

    fresh:
      isFresh(
        manifest
      ),

    acceptablyStale:
      isAcceptablyStale(
        manifest
      ),

    dataDir:
      baseDir(),

    manifest
  };
}

export function startSunatPadronAutoRefresh() {
  if (refreshTimer) {
    return refreshTimer;
  }

  const intervalMs =
    Math.max(
      60 * 60_000,

      (
        refreshHours() *
        60 *
        60_000
      ) / 4
    );

  refreshTimer =
    setInterval(
      () => {
        ensureSunatPadron()
          .catch(
            (error) => {
              console.error(
                "[SUNAT PADRON] Scheduled refresh failed:",
                error.message
              );
            }
          );
      },
      intervalMs
    );

  refreshTimer.unref?.();

  return refreshTimer;
}

export const sunatPadronInternals =
  Object.freeze({
    parsePadronLine,
    parseDatasetDateFromHtml,
    normalizedRuc
  });

export async function pruneSunatPadronGenerations() {
  const root = path.resolve(baseDir());
  const active = path.resolve(currentDir());
  const entries = [];
  for (const name of await fsp.readdir(root)) {
    if (!/^next-[0-9]+-[0-9]+$/.test(name)) continue;
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root || target === active) continue;
    const stat = await fsp.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    entries.push({ target, mtime: stat.mtimeMs });
  }
  entries.sort((a,b)=>b.mtime-a.mtime);
  // Keep two previous generations and a seven-day grace period for readers/rollback.
  for (const entry of entries.slice(2)) {
    if (Date.now()-entry.mtime > 7*86400000) await fsp.rm(entry.target,{recursive:true,force:true});
  }
}
