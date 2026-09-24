import bcrypt from "bcrypt";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, REQUEST_STATUS } from "../utils/constants.js";

const terminalStatuses = [REQUEST_STATUS.CLOSED, REQUEST_STATUS.PAID_CLOSED, REQUEST_STATUS.VOIDED, REQUEST_STATUS.REJECTED];

const editableFields = ["employeeCode", "dni", "name", "email", "jefe", "jobTitle", "organizationalUnit", "role", "approvalLevel", "approvalAreas", "costCenter", "authorizedCostCenters", "permissions", "area", "active"];

function editablePayload(body) {
  return Object.fromEntries(editableFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

// Any authenticated user may see their own direct reports (not gated to
// Admin) — this is what powers "My Team" for a jefe at any level.
export const listMyTeam = asyncHandler(async (req, res) => {
  const reports = await User.find({ jefe: req.user._id, active: true })
    .select("name area jobTitle role organizationalUnit costCenter")
    .populate("costCenter", "code name")
    .sort({ name: 1 });
  const reportIds = reports.map((report) => report._id);
  const counts = reportIds.length ? await FinancialRequest.aggregate([
    { $match: { $or: [{ requester: { $in: reportIds } }, { solicitor: { $in: reportIds } }] } },
    { $group: { _id: { $ifNull: ["$requester", "$solicitor"] }, total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ["$status", terminalStatuses] }, 0, 1] } } } }
  ]) : [];
  const countsById = new Map(counts.map((row) => [String(row._id), row]));
  const data = reports.map((report) => ({
    ...report.toObject(),
    requestCounts: countsById.get(String(report._id)) || { total: 0, active: 0 }
  }));
  res.json({ data });
});

export const listUsers = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.active !== undefined) query.active = req.query.active === "true";
  if (req.query.role) query.role = req.query.role;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ name: search }, { email: search }, { employeeCode: search }, { dni: search }, { area: search }];
  }
  const { page, pageSize, skip } = parsePagination({ ...req.query, pageSize: req.query.pageSize || 100 });
  const sort = parseSort(req.query, ["name", "email", "role", "area", "active", "createdAt"], { name: 1 });
  const [data, total] = await Promise.all([
    User.find(query).populate("costCenter authorizedCostCenters").sort(sort).skip(skip).limit(pageSize),
    User.countDocuments(query)
  ]);
  res.json(paginatedPayload(data, total, page, pageSize));
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, dni, email, password, role } = req.body;
  if (!name || !dni || !password || !role) throw new AppError(400, "Name, DNI, password, and role are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (String(password).length < 10) throw new AppError(422, "Password must contain at least 10 characters.", { field: "password" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedDni = String(dni).trim();
  if (await User.exists({ dni: normalizedDni })) throw new AppError(409, "A user with this DNI already exists.", undefined, ERROR_CODES.CONFLICT);
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) throw new AppError(409, "A user with this email already exists.", undefined, ERROR_CODES.CONFLICT);
  }
  const user = await User.create({ ...editablePayload(req.body), dni: normalizedDni, email: email ? String(email).trim().toLowerCase() : undefined, passwordHash: await bcrypt.hash(password, 12) });
  await recordAudit({ entityType: "User", entity: user, action: "CREATED", user: req.user, req, module: "USER_ADMIN", newValues: { name: user.name, dni: user.dni, role: user.role, area: user.area, active: user.active } });
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id) && req.body.active === false) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  const oldValues = { name: user.name, email: user.email, role: user.role, area: user.area, active: user.active, approvalLevel: user.approvalLevel };
  Object.assign(user, editablePayload(req.body));
  if (req.body.email) user.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password) {
    if (String(req.body.password).length < 10) throw new AppError(422, "Password must contain at least 10 characters.", { field: "password" }, ERROR_CODES.VALIDATION_ERROR);
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
  }
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "UPDATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { name: user.name, email: user.email, role: user.role, area: user.area, active: user.active, approvalLevel: user.approvalLevel, passwordChanged: Boolean(req.body.password) } });
  res.json({ data: user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, "User not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  if (String(user._id) === String(req.user._id)) throw new AppError(409, "You cannot deactivate your own signed-in account.", undefined, ERROR_CODES.CONFLICT);
  const oldValues = { active: user.active };
  user.active = false;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "DEACTIVATED", user: req.user, req, module: "USER_ADMIN", oldValues, newValues: { active: false } });
  res.json({ data: user });
});
