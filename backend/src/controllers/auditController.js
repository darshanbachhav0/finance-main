import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";

export const listAuditLogs = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.module) query.module = req.query.module;
  if (req.query.action) query.action = req.query.action;
  if (req.query.entityType) query.entityType = req.query.entityType;
  if (req.query.requestId) query.requestId = req.query.requestId;
  if (req.query.blocked !== undefined) query.blocked = req.query.blocked === "true";
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    const userIds = await User.distinct("_id", { $or: [{ name: search }, { email: search }, { role: search }] });
    query.$or = [
      { action: search },
      { module: search },
      { entityType: search },
      { message: search },
      { role: search },
      { user: { $in: userIds } }
    ];
  }
  const { page, pageSize, skip } = parsePagination(req.query);
  const sort = parseSort(req.query, ["createdAt", "module", "action"], { createdAt: -1 });
  const [data, total] = await Promise.all([
    AuditLog.find(query).populate("user", "name email role").sort(sort).skip(skip).limit(pageSize),
    AuditLog.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

export const requestAuditTimeline = asyncHandler(async (req, res) => {
  const data = await AuditLog.find({ requestId: req.params.id }).populate("user", "name email role").sort({ createdAt: 1 });
  res.json({ data });
});
