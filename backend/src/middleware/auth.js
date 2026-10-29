import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "./asyncHandler.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, PERMISSIONS, ROLES } from "../utils/constants.js";
import { hasPermission, hasRole, isReadOnlyOverseer, readsByCostCenter } from "../utils/permissions.js";
import { getPlatformSettings, passwordExpired } from "../services/platformSettingsService.js";
import { visibleCostCenterIdsFor } from "../services/costCenterCascadeService.js";

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

// Administrator accounts may be required to sign in with an authenticator app
// (ADMIN_2FA_REQUIRED=true). Accounts that already enrolled always use it.
export function adminTwoFactorRequired(env = process.env) {
  return env.ADMIN_2FA_REQUIRED === "true";
}

export function needsTwoFactorSetup(user, env = process.env) {
  return hasRole(user, ROLES.ADMIN) && adminTwoFactorRequired(env) && !user.twoFactor?.enabled;
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
    if (settings.maintenance?.enabled && !hasRole(user, ROLES.ADMIN)) {
      throw new AppError(503, "The platform is in maintenance. Try again later.", { message: settings.maintenance.message || undefined }, ERROR_CODES.MAINTENANCE_MODE);
    }
    if ((user.passwordResetRequired || passwordExpired(user, settings)) && !PASSWORD_CHANGE_PATHS.includes(path)) {
      throw new AppError(403, "Change your initial password before using the platform.", undefined, "PASSWORD_CHANGE_REQUIRED");
    }
    if (needsTwoFactorSetup(user) && !TWO_FACTOR_SETUP_PATHS.includes(path)) {
      throw new AppError(403, "Set up your authenticator app before using the platform.", undefined, ERROR_CODES.TWO_FACTOR_SETUP_REQUIRED);
    }

    // The cost centers whose requests a responsible, Vicerrector or requester reads (their cascade).
    if (readsByCostCenter(user)) user.$locals.visibleCostCenterIds = await visibleCostCenterIdsFor(user);
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "Invalid or expired authentication token.", undefined, ERROR_CODES.FORBIDDEN);
  }
});

// Auditoría reads the institution's financial history (Manual técnico: "solo lectura, toda la
// universidad"): on GET/HEAD it passes a guard whenever the guard protects financial work. It never
// passes the administration guards (employees, roles, platform), and never a write
// (readOnlyOversight below refuses those before any guard runs).
const ADMINISTRATION_PERMISSIONS = Object.freeze([PERMISSIONS.EMPLOYEE_MANAGE, PERMISSIONS.ROLE_MANAGE, PERMISSIONS.PERMISSION_MANAGE, PERMISSIONS.PLATFORM_MANAGE]);
const FINANCIAL_ROLES = Object.freeze([ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.GAF, ROLES.MANAGEMENT]);

function auditorReads(req, { roles = [], permissions = [] } = {}) {
  if (!isReadOnlyOverseer(req.user) || !isSafeMethod(req)) return false;
  return roles.some((role) => FINANCIAL_ROLES.includes(role)) || permissions.some((permission) => !ADMINISTRATION_PERMISSIONS.includes(permission));
}

function forbidden(required) {
  return new AppError(403, "You do not have permission to perform this action.", required ? { required } : undefined, ERROR_CODES.FORBIDDEN);
}

// Role guard: any of the person's roles (primary or additional) passes.
export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !(hasRole(req.user, roles) || auditorReads(req, { roles }))) throw forbidden();
    next();
  };
}

// Role list OR any of the permissions (every role's grants plus the person's extra grants).
export function authorizeAccess({ roles = [], permissions = [] }) {
  return (req, _res, next) => {
    if (!req.user || !(hasRole(req.user, roles) || permissions.some((permission) => hasPermission(req.user, permission)) || auditorReads(req, { roles, permissions }))) {
      throw forbidden(permissions);
    }
    next();
  };
}

// The central guard: the route needs any of these permissions (shared/accessControl.mjs).
export function authorizePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user || !(permissions.some((permission) => hasPermission(req.user, permission)) || auditorReads(req, { permissions }))) {
      throw forbidden(permissions);
    }
    next();
  };
}

// Reads that still record something in a process (official export history). Not for Auditoría.
export const READ_ONLY_BLOCKED_READS = Object.freeze(["/api/sire/export", "/api/accounting/consolidation/export"]);
// Auditoría writes only its own notification settings.
export const AUDITOR_WRITE_PATHS = Object.freeze(["/api/notifications/", "/api/users/me/notification-preferences"]);

export function auditorMayCall(method, rawPath) {
  // Express matches routes case-insensitively (/api/SIRE/export reaches /api/sire/export).
  const path = String(rawPath || "").toLowerCase();
  if (SAFE_METHODS.includes(String(method || "GET").toUpperCase())) return !READ_ONLY_BLOCKED_READS.some((blocked) => path === blocked || path.startsWith(`${blocked}/`));
  return AUDITOR_WRITE_PATHS.some((allowed) => path === allowed.replace(/\/$/, "") || path.startsWith(allowed));
}

// Mounted after protect() on the internal API: Auditoría never takes part in a process.
export function readOnlyOversight(req, _res, next) {
  if (!isReadOnlyOverseer(req.user) || auditorMayCall(req.method, requestPath(req))) return next();
  throw new AppError(403, "Auditoría es de solo lectura: puede consultar pero no modificar el trabajo de la plataforma.", undefined, ERROR_CODES.READ_ONLY_ROLE);
}
