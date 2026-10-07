import { readAsset } from "../services/durableAssetService.js";
import crypto from "crypto";
import path from "path";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { assertStoredAssetAccess, resolveStoredAsset } from "../services/fileAccessService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

function safeDownloadName(value, fallback) {
  return path.basename(String(value || fallback)).replace(/[\r\n"]/g, "_").slice(0, 180);
}

export const downloadStoredFile = asyncHandler(async (req, res) => {
  const asset = resolveStoredAsset(req.query.path);
  const access = await assertStoredAssetAccess(asset, req.user);
  let content;
  try { content = await readAsset(asset.absolutePath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new AppError(404, "Stored file was not found.", undefined, ERROR_CODES.NOT_FOUND);
  }
  if (access?.checksum && crypto.createHash("sha256").update(content).digest("hex") !== access.checksum) {
    throw new AppError(409, "This bank file no longer matches the file that was generated, so it cannot be downloaded.", undefined, ERROR_CODES.BANK_FILE_INTEGRITY_FAILED);
  }

  const disposition = req.query.disposition === "inline" ? "inline" : "attachment";
  const fileName = safeDownloadName(req.query.name, path.basename(asset.absolutePath));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `${disposition}; filename="${fileName}"`);
  res.type(path.extname(asset.absolutePath));
  res.send(content);
});
