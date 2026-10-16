import { Router } from "express";
import multer from "multer";
import path from "path";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { MAX_IMPORT_BYTES, runExcelImport } from "../services/excelImportService.js";

// POST /imports/:kind with one .xlsx file ("file"). ?dryRun=false saves; anything else only checks.
// The file is read in memory and never stored. Roles per import: services/excelImportService.js.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".xlsx") cb(new AppError(400, "Upload an Excel file (.xlsx).", undefined, ERROR_CODES.VALIDATION_ERROR));
    else cb(null, true);
  }
}).single("file");

const router = Router();
router.post("/:kind", upload, asyncHandler(async (req, res) => {
  res.json({ data: await runExcelImport({ kind: req.params.kind, buffer: req.file?.buffer, fileName: req.file?.originalname, dryRun: String(req.query.dryRun) !== "false", user: req.user, req }) });
}));

export default router;
