import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "./asyncHandler.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { ADMINISTRATOR_ROLES, ERROR_CODES, ROLES } from "../utils/constants.js";
import { hasPermission } from "../utils/permissions.js";
import { getPlatformSettings, passwordExpired } from "../services/platformSettingsService.js";

// What a session that must first change its password (or enrol its authenticator app) may call.
const PASSWORD_CHANGE_PATHS = ["/api/auth/me", "/api/auth/change-password", "/api/auth/logout", "/api/auth/platform-status"];
const TWO_FACTOR_SETUP_PATHS = [...PASSWORD_CHANGE_PATHS, "/api/auth/two-factor/setup", "/api/auth/two-factor/enable"];

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

function isSafeMethod(req) {
  return SAFE_METHODS.includes(String(req.method || "GET").toUpperCase());
}

function requestPath(req) {
  return String(req.originalUrl || "").split("?")[0];
}

// The Super Admin must sign in with an authenticator app. SUPER_ADMIN_2FA_REQUIRED=false turns
// that off (local development only; never in production).
export function superAdminTwoFactorRequired(env = process.env) {
  if (env.NODE_ENV === "production") return true;
  return env.SUPER_ADMIN_2FA_REQUIRED !== "false";
}

export function needsTwoFactorSetup(user, env = process.env) {
  return user?.role === ROLES.SUPER_ADMIN && superAdminTwoFactorRequired(env) && !user.twoFactor?.enabled;
}

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
    const path = requestPath(req);
    const settings = await getPlatformSettings();
    if (settings.maintenance?.enabled && !ADMINISTRATOR_ROLES.includes(user.role)) {
      throw new AppError(503, "The platform is in maintenance. Try again later.", { message: settings.maintenance.message || undefined }, ERROR_CODES.MAINTENANCE_MODE);
    }
    if ((user.passwordResetRequired || passwordExpired(user, settings)) && !PASSWORD_CHANGE_PATHS.includes(path)) {
      throw new AppError(403, "Change your initial password before using the platform.", undefined, "PASSWORD_CHANGE_REQUIRED");
    }
    if (needsTwoFactorSetup(user) && !TWO_FACTOR_SETUP_PATHS.includes(path)) {
      throw new AppError(403, "Set up your authenticator app before using the platform.", undefined, ERROR_CODES.TWO_FACTOR_SETUP_REQUIRED);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "Invalid or expired authentication token.", undefined, ERROR_CODES.FORBIDDEN);
  }
});

// Read-only oversight: on GET/HEAD the Super Admin passes every route guard an Admin passes, so it
// sees what an Admin sees. It never passes a guard on a write (superAdminReadOnly below refuses
// those before any guard runs, outside its own account-administration routes).
function superAdminReads(req, roles = [ROLES.ADMIN]) {
  return req.user?.role === ROLES.SUPER_ADMIN && isSafeMethod(req) && roles.includes(ROLES.ADMIN);
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !(roles.includes(req.user.role) || superAdminReads(req, roles))) {
      throw new AppError(403, "You do not have permission to perform this action.", undefined, ERROR_CODES.FORBIDDEN);
    }
    next();
  };
}

// Role list OR any of the permissions (role defaults plus the user's granted extras).
export function authorizeAccess({ roles = [], permissions = [] }) {
  return (req, _res, next) => {
    if (!req.user || !(roles.includes(req.user.role) || permissions.some((permission) => hasPermission(req.user, permission)) || superAdminReads(req))) {
      throw new AppError(403, "You do not have permission to perform this action.", { required: permissions }, ERROR_CODES.FORBIDDEN);
    }
    next();
  };
}

export function authorizePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user || !(permissions.some((permission) => hasPermission(req.user, permission)) || superAdminReads(req))) {
      throw new AppError(403, "You do not have permission to perform this action.", { required: permissions }, ERROR_CODES.FORBIDDEN);
    }
    next();
  };
}

// Writes the Super Admin may make: its own account administration, its personal settings
// (notifications, email preference, form drafts) and the CECO budget plans it manages with Admin
// and Treasury (the routes still check the role). Everything else is read-only for it.
export const SUPER_ADMIN_WRITE_PATHS = Object.freeze(["/api/superadmin/", "/api/notifications/", "/api/users/me/notification-preferences", "/api/work-drafts/", "/api/budget/plans/", "/api/budget/plan-changes/"]);
// Reads that still record something in a process (official export history). Not for the Super Admin.
export const SUPER_ADMIN_BLOCKED_READS = Object.freeze(["/api/sire/export", "/api/accounting/consolidation/export"]);

export function superAdminMayCall(method, rawPath) {
  const safe = SAFE_METHODS.includes(String(method || "GET").toUpperCase());
  // Express matches routes case-insensitively (/api/SIRE/export reaches /api/sire/export).
  const path = String(rawPath || "").toLowerCase();
  if (safe) return !SUPER_ADMIN_BLOCKED_READS.some((blocked) => path === blocked || path.startsWith(`${blocked}/`));
  return SUPER_ADMIN_WRITE_PATHS.some((allowed) => path === allowed.replace(/\/$/, "") || path.startsWith(allowed));
}

// Mounted after protect() on the internal API: the Super Admin never takes part in a process.
export function superAdminReadOnly(req, _res, next) {
  if (req.user?.role !== ROLES.SUPER_ADMIN || superAdminMayCall(req.method, requestPath(req))) return next();
  throw new AppError(403, "The Super Admin account is read-only here: it can view but not change the work of the platform.", undefined, ERROR_CODES.READ_ONLY_ROLE);
}
