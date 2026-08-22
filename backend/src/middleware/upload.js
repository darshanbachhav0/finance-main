import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { tempUploadDir } from "../services/storageService.js";

fs.mkdirSync(tempUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempUploadDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});

const allowedMimeByExtension = new Map([
  [".xml", new Set(["application/xml", "text/xml", "text/plain", "application/octet-stream"])],
  [".pdf", new Set(["application/pdf", "application/octet-stream"])],
  [".txt", new Set(["text/plain", "application/octet-stream"])],
  [".csv", new Set(["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"])],
  [".json", new Set(["application/json", "text/plain", "application/octet-stream"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".doc", new Set(["application/msword", "application/octet-stream"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"])],
  [".xls", new Set(["application/vnd.ms-excel", "application/octet-stream"])],
  [".zip", new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"])]
]);

function fileFilter(_req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();
  const allowedMimes = allowedMimeByExtension.get(extension);
  if (!allowedMimes || !allowedMimes.has(String(file.mimetype || "").toLowerCase())) {
    cb(new AppError(400, "The uploaded file type is not allowed.", { extension, mime: file.mimetype }, ERROR_CODES.VALIDATION_ERROR));
    return;
  }
  cb(null, true);
}

export const uploadFields = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 60, fields: 120, parts: 200 }
}).fields([
  { name: "xml", maxCount: 1 },
  { name: "pdf", maxCount: 1 },
  { name: "quotation", maxCount: 20 },
  { name: "purchaseOrder", maxCount: 2 },
  { name: "contract", maxCount: 2 },
  { name: "conformity", maxCount: 3 },
  { name: "activityReport", maxCount: 3 },
  { name: "supporting", maxCount: 8 },
  { name: "rendition", maxCount: 12 },
  { name: "returnReceipt", maxCount: 3 },
  { name: "cciLetter", maxCount: 2 },
  { name: "rucFile", maxCount: 1 },
  { name: "bankCertificate", maxCount: 1 },
  { name: "legalRepId", maxCount: 1 },
  { name: "batchFile", maxCount: 1 }
]);
