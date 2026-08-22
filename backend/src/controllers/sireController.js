import GeneratedFile from "../models/GeneratedFile.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { buildSirePreview, exportSireFile } from "../services/sireService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";

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

export const previewSire = asyncHandler(async (req, res) => {
  const preview = await buildSirePreview(req.query.period);
  res.json({ data: preview.rows, validations: preview.validations, summary: preview.summary });
});

export const exportSire = asyncHandler(async (req, res) => {
  if ((req.query.format || "json") !== "csv") {
    const preview = await buildSirePreview(req.query.period);
    res.json({ data: preview.rows, validations: preview.validations, summary: preview.summary });
    return;
  }
  const result = await exportSireFile({ period: req.query.period, user: req.user });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${result.history.fileName}`);
  res.send(result.content);
});
