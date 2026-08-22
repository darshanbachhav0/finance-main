import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { openZipEntryStream } from "../utils/zipReader.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

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
  return path.join(
    baseDir(),
    "current"
  );
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
    return JSON.parse(
      await fsp.readFile(
        manifestPath(),
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

async function writeJson(
  filePath,
  value
) {
  await fsp.mkdir(
    path.dirname(filePath),
    {
      recursive: true
    }
  );

  await fsp.writeFile(
    filePath,
    `${JSON.stringify(
      value,
      null,
      2
    )}\n`,
    "utf8"
  );
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

function datasetExists(
  manifest
) {
  return Boolean(
    manifest?.rows > 0 &&
      fs.existsSync(
        currentChunksDir()
      )
  );
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

  await pipeline(
    Readable.fromWeb(
      response.body
    ),
    fs.createWriteStream(
      temp
    )
  );

  const stat =
    await fsp.stat(temp);

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

      const record =
        parsePadronLine(
          line
        );

      if (!record) {
        skipped += 1;
        continue;
      }

      const prefix =
        record.ruc.slice(
          0,
          CHUNK_PREFIX_LENGTH
        );

      if (
        prefix !==
        currentPrefix
      ) {
        await closeWriteStream(
          currentStream
        );

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

      if (
        !currentStream.write(
          `${line}\n`,
          "utf8"
        )
      ) {
        await new Promise(
          (
            resolve,
            reject
          ) => {
            currentStream.once(
              "drain",
              resolve
            );

            currentStream.once(
              "error",
              reject
            );
          }
        );
      }

      rowCount += 1;

      if (
        rowCount %
          500_000 ===
        0
      ) {
        console.log(
          `[SUNAT PADRON] Indexed ${rowCount.toLocaleString(
            "en-US"
          )} RUC rows...`
        );
      }
    }
  } finally {
    await closeWriteStream(
      currentStream
    );

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

  const manifest = {
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

async function activateStaging(
  stagingDir
) {
  const live =
    currentDir();

  const previous =
    path.join(
      baseDir(),
      "previous"
    );

  await fsp.rm(
    previous,
    {
      recursive: true,
      force: true
    }
  );

  if (
    fs.existsSync(live)
  ) {
    await fsp.rename(
      live,
      previous
    );
  }

  try {
    await fsp.rename(
      stagingDir,
      live
    );

    await fsp.rm(
      previous,
      {
        recursive: true,
        force: true
      }
    );
  } catch (error) {
    if (
      !fs.existsSync(
        live
      ) &&
      fs.existsSync(
        previous
      )
    ) {
      await fsp.rename(
        previous,
        live
      );
    }

    throw error;
  }
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
  force = false
} = {}) {
  const before =
    await readManifest();

  if (
    !force &&
    datasetExists(before) &&
    isFresh(before)
  ) {
    return {
      ...before,
      changed: false,
      cached: true
    };
  }

  const lockHandle =
    await acquireCrossProcessLock();

  try {
    const current =
      await readManifest();

    if (
      !force &&
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

    const downloadMeta =
      await downloadPadronZip({
        previousManifest:
          current,

        force
      });

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

export async function lookupSunatPadronRuc(
  identifier
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

  if (
    memoryCache.has(ruc)
  ) {
    return memoryCache.get(
      ruc
    );
  }

  const manifest =
    await ensureSunatPadron();

  if (
    !datasetExists(
      manifest
    )
  ) {
    throw new AppError(
      503,
      "SUNAT public Padrón dataset is not available.",
      undefined,
      ERROR_CODES
        .INTEGRATION_NOT_CONFIGURED
    );
  }

  const chunkFile =
    path.join(
      currentChunksDir(),
      `${ruc.slice(
        0,
        CHUNK_PREFIX_LENGTH
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
      ruc,
      result
    );

    return result;
  }

  const input =
    fs.createReadStream(
      chunkFile,
      {
        encoding: "utf8"
      }
    );

  const lines =
    readline.createInterface({
      input,
      crlfDelay: Infinity
    });

  try {
    for await (
      const line of lines
    ) {
      if (
        String(line).slice(
          0,
          11
        ) !== ruc
      ) {
        continue;
      }

      const record =
        parsePadronLine(
          line
        );

      const result = {
        found:
          Boolean(record),

        ruc,
        record,
        manifest
      };

      cachePut(
        ruc,
        result
      );

      return result;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  const result = {
    found: false,
    ruc,
    manifest
  };

  cachePut(
    ruc,
    result
  );

  return result;
}

export async function getSunatPadronStatus() {
  const manifest =
    await readManifest();

  return {
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