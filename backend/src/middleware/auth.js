import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "./asyncHandler.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { hasPermission } from "../utils/permissions.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw new AppError(401, "Authentication token is required.", undefined, ERROR_CODES.FORBIDDEN);
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.id).select("-passwordHash");

    if (!user || !user.active) {
      throw new AppError(401, "User is inactive or no longer exists.", undefined, ERROR_CODES.FORBIDDEN);
    }

    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) throw new AppError(401, "Your credentials changed. Sign in again.");
    if (user.passwordResetRequired && !["/api/auth/me", "/api/auth/change-password"].includes(req.originalUrl?.split("?")[0])) {
      throw new AppError(403, "Change your initial password before using the platform.", undefined, "PASSWORD_CHANGE_REQUIRED");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "Invalid or expired authentication token.", undefined, ERROR_CODES.FORBIDDEN);
  }
});

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, "You do not have permission to perform this action.", undefined, ERROR_CODES.FORBIDDEN);
    }
    next();
  };
}

export function authorizePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user || !permissions.some((permission) => hasPermission(req.user, permission))) {
      throw new AppError(403, "You do not have permission to perform this action.", { required: permissions }, ERROR_CODES.FORBIDDEN);
    }
    next();
  };
}
