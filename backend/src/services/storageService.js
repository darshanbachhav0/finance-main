import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadRoot = path.resolve(__dirname, "..", "..", "uploads");
export const generatedRoot = path.resolve(__dirname, "..", "..", "generated");
export const tempUploadDir = path.join(uploadRoot, "tmp");
const allowedDomains = new Set(["requests", "suppliers"]);

const signatures = {
  ".pdf": (buffer) => buffer.subarray(0, 4).toString() === "%PDF",
  ".png": (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8,
  ".jpeg": (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8,
  ".doc": (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  ".docx": (buffer) => buffer.subarray(0, 2).toString() === "PK",
  ".xlsx": (buffer) => buffer.subarray(0, 2).toString() === "PK",
  ".zip": (buffer) => buffer.subarray(0, 2).toString() === "PK",
  ".xls": (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  ".xml": (buffer) => buffer.toString("utf8").replace(/^\uFEFF/, "").trimStart().startsWith("<"),
  ".json": (buffer) => {
    try { JSON.parse(buffer.toString("utf8")); return true; } catch { return false; }
  },
  ".txt": () => true,
  ".csv": () => true
};

export async function validateUploadedFile(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const content = await fs.readFile(file.path);
  const valid = signatures[extension]?.(content);
  if (!valid) {
    await fs.rm(file.path, { force: true });
    throw new AppError(422, "Uploaded file content does not match its extension.", { file: file.originalname, extension }, ERROR_CODES.VALIDATION_ERROR);
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function persistUploadedFiles(files = {}, { domain, entityId }) {
  if (!allowedDomains.has(domain)) throw new Error(`Unsupported storage domain: ${domain}`);
  const destination = path.join(uploadRoot, domain, String(entityId));
  await fs.mkdir(destination, { recursive: true });
  const result = {};
  const moved = [];
  const incoming = Object.values(files || {}).flat().filter(Boolean);
  try {
    for (const [field, items] of Object.entries(files || {})) {
      result[field] = [];
      for (const file of items || []) {
        const checksum = await validateUploadedFile(file);
        const finalPath = path.join(destination, path.basename(file.filename));
        await fs.rename(file.path, finalPath);
        moved.push(finalPath);
        result[field].push({
          ...file,
          path: finalPath,
          destination,
          checksum,
          url: `/uploads/${domain}/${entityId}/${path.basename(file.filename)}`
        });
      }
    }
    return result;
  } catch (error) {
    await Promise.all([
      ...moved.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)),
      ...incoming.map((file) => fs.rm(file.path, { force: true }).catch(() => undefined))
    ]);
    throw error;
  }
}

export async function cleanupUploadedFiles(files = {}) {
  await Promise.all(Object.values(files).flat().map((file) => fs.rm(file.path, { force: true }).catch(() => undefined)));
}
