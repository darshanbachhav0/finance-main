import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { uploadRoot, generatedRoot } from "./storageService.js";

export const durableAssetsEnabled = () => process.env.DURABLE_ASSETS === "true" || (process.env.RENDER === "true" && process.env.DURABLE_ASSETS !== "false");
export function assetKey(file) {
  const normalized = String(file).replace(/\\/g, "/");
  for (const [root, prefix] of [[uploadRoot, "/uploads/"], [generatedRoot, "/generated/"]]) {
    const absolute = path.resolve(file);
    const relative = path.relative(root, absolute);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return prefix + relative.replace(/\\/g, "/");
    // Historical absolute paths may refer to a previous deployment's root.
    const at = normalized.lastIndexOf(prefix);
    if (at >= 0) {
      const suffix = normalized.slice(at + prefix.length);
      if (suffix.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "..")) return prefix + suffix;
    }
  }
  throw new Error("File is outside protected storage.");
}
function bucket() { return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "protectedAssets" }); }
export async function archiveAsset(file) {
  if (!durableAssetsEnabled()) return;
  const key = assetKey(file);
  const bytes = await fs.readFile(file);
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const existing = await bucket().find({ filename: key, "metadata.checksum": checksum }).next();
  if (existing) return;
  await pipeline(Readable.from([bytes]), bucket().openUploadStream(key, { metadata: { checksum } }));
}
export async function readAsset(file, encoding) {
  try { return await fs.readFile(file, encoding); }
  catch (error) {
    if (error.code !== "ENOENT" || !durableAssetsEnabled()) throw error;
    let key;
    try { key = assetKey(file); } catch { throw error; }
    const record = await bucket().find({ filename: key }).sort({ uploadDate: -1 }).next();
    if (!record) throw error;
    const chunks = [];
    for await (const chunk of bucket().openDownloadStream(record._id)) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== record.metadata.checksum) throw new Error("Stored evidence checksum mismatch.");
    return encoding ? bytes.toString(encoding) : bytes;
  }
}

export async function materializeAsset(file) {
  try { await fs.access(file); return file; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const key = assetKey(file);
  const root = key.startsWith("/uploads/") ? uploadRoot : generatedRoot;
  const target = path.join(root, ...key.split("/").slice(2));
  const bytes = await readAsset(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return target;
}
