import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { ROLES } from "../utils/constants.js";
import { recordAudit } from "../services/auditService.js";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  });
}

export const login = asyncHandler(async (req, res) => {
  const { dni, email, password } = req.body;
  if (typeof password !== "string" || !password || (!dni && !email)) throw new AppError(400, "DNI and password are required.");

  // DNI is the login identifier going forward. The email fallback exists only
  // for one transition release so already-issued frontend builds keep working;
  // remove it once every client sends dni.
  const user = dni
    ? await User.findOne({ dni: String(dni).trim() })
    : await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !user.active || !(await user.comparePassword(password))) {
    throw new AppError(401, "Invalid credentials.");
  }

  res.json({ token: signToken(user), user });
});

export const register = asyncHandler(async (req, res) => {
  const { name, dni, email, password, area } = req.body;
  if (!name || !dni || !password) throw new AppError(400, "Name, DNI, and password are required.");

  const existing = await User.findOne({ dni: String(dni).trim() });
  if (existing) throw new AppError(409, "A user with this DNI already exists.");

  const userCount = await User.countDocuments();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    dni: String(dni).trim(),
    email: email || undefined,
    passwordHash,
    area,
    role: userCount === 0 ? ROLES.ADMIN : ROLES.SOLICITOR
  });

  res.status(201).json({ token: signToken(user), user });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 10 || newPassword.length > 72) {
    throw new AppError(422, "Use a password between 10 and 72 characters and provide your current password.");
  }
  const user = await User.findById(req.user._id);
  if (!user || !(await user.comparePassword(currentPassword))) throw new AppError(401, "The current password is incorrect.");
  if (currentPassword === newPassword) throw new AppError(422, "Choose a different password.");
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordResetRequired = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "PASSWORD_CHANGED", user, req, module: "AUTH", newValues: { passwordResetRequired: false, sessionsRevoked: true } });
  res.json({ token: signToken(user), user });
});
