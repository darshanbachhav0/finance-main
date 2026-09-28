import GeneratedFile from "../models/GeneratedFile.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { buildSirePreview, exportSireFile } from "../services/sireService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

export const listSireExports = asyncHandler(async (req, res) => {
  const query = { kind: "SIRE_CSV" };
  if (req.query.period) query.period = req.query.period;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ fileName: search }, { period: search }, { requestNumbers: search }];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["createdAt", "period", "fileName", "rowCount"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    GeneratedFile.find(query).populate("generatedBy", "name email role").sort(sort).skip(skip).limit(pageSize),
    GeneratedFile.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

function previewPayload(preview) {
  return { data: preview.rows, validations: preview.validations, summary: preview.summary };
}

export const previewSire = asyncHandler(async (req, res) => {
  res.json(previewPayload(await buildSirePreview(req.query.period)));
});

// GET /sire/export?period=YYYY-MM                          -> validation preview (JSON)
// GET /sire/export?period=YYYY-MM&format=txt               -> SUNAT RCE TXT attachment, official name
// GET /sire/export?period=YYYY-MM&format=txt&delivery=json -> the same file as { fileName, content } (UI)
export const exportSire = asyncHandler(async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  if (format === "json") {
    res.json(previewPayload(await buildSirePreview(req.query.period)));
    return;
  }
  if (format !== "txt") {
    throw new AppError(422, "Unsupported SIRE export format. SUNAT's RCE is generated as TXT (format=txt).", { format }, ERROR_CODES.VALIDATION_ERROR);
  }
  const result = await exportSireFile({ period: req.query.period, user: req.user });
  if (req.query.delivery === "json") {
    res.json({ fileName: result.fileName, content: result.content, history: result.history, summary: result.preview.summary });
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.send(result.content);
});
