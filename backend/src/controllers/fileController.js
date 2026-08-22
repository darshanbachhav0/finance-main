import fs from "fs/promises";
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
  await assertStoredAssetAccess(asset, req.user);
  try {
    const stat = await fs.stat(asset.absolutePath);
    if (!stat.isFile()) throw new Error("Not a file");
  } catch {
    throw new AppError(404, "Stored file was not found.", undefined, ERROR_CODES.NOT_FOUND);
  }

  const disposition = req.query.disposition === "inline" ? "inline" : "attachment";
  const fileName = safeDownloadName(req.query.name, path.basename(asset.absolutePath));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `${disposition}; filename="${fileName}"`);
  res.sendFile(asset.absolutePath);
});
