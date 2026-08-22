import bcrypt from "bcrypt";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { recordAudit } from "../services/auditService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort } from "../services/queryService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const editableFields = ["name", "email", "role", "approvalLevel", "approvalAreas", "costCenter", "authorizedCostCenters", "permissions", "area", "active"];

function editablePayload(body) {
  return Object.fromEntries(editableFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

export const listUsers = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.active !== undefined) query.active = req.query.active === "true";
  if (req.query.role) query.role = req.query.role;
  if (req.query.search) {
    const search = new RegExp(escapedRegex(req.query.search), "i");
    query.$or = [{ name: search }, { email: search }, { area: search }];
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
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) throw new AppError(400, "Name, email, password, and role are required.", undefined, ERROR_CODES.VALIDATION_ERROR);
  if (String(password).length < 10) throw new AppError(422, "Password must contain at least 10 characters.", { field: "password" }, ERROR_CODES.VALIDATION_ERROR);
  const normalizedEmail = String(email).trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) throw new AppError(409, "A user with this email already exists.", undefined, ERROR_CODES.CONFLICT);
  const user = await User.create({ ...editablePayload(req.body), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12) });
  await recordAudit({ entityType: "User", entity: user, action: "CREATED", user: req.user, req, module: "USER_ADMIN", newValues: { name: user.name, email: user.email, role: user.role, area: user.area, active: user.active } });
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
