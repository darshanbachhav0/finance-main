import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { ROLES } from "../utils/constants.js";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || "dev_secret_change_me", {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  });
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError(400, "Email and password are required.");

  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !user.active || !(await user.comparePassword(password))) {
    throw new AppError(401, "Invalid credentials.");
  }

  res.json({ token: signToken(user), user });
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, area } = req.body;
  if (!name || !email || !password) throw new AppError(400, "Name, email, and password are required.");

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) throw new AppError(409, "A user with this email already exists.");

  const userCount = await User.countDocuments();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    passwordHash,
    area,
    role: userCount === 0 ? ROLES.ADMIN : ROLES.SOLICITOR
  });

  res.status(201).json({ token: signToken(user), user });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});
