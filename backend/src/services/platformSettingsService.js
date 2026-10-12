import PlatformSettings from "../models/PlatformSettings.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES } from "../utils/constants.js";
import { recordAudit } from "./auditService.js";

// Platform settings (Super Admin > Platform settings): password policy, session length,
// maintenance mode and the announcement banner. Every request reads them (protect() checks
// maintenance mode), so they are cached briefly; saving through this service clears the cache.
const CACHE_MS = 15000;
let cached = null;
let cachedAt = 0;

export const SETTINGS_LIMITS = Object.freeze({
  minLength: [10, 72],
  expiryDays: [0, 365],
  maxFailedAttempts: [1, 20],
  lockoutMinutes: [1, 1440],
  userMinutes: [15, 1440],
  superAdminMinutes: [10, 240]
});

const SUPER_ADMIN_DEFAULT_SESSION_MINUTES = 60;

export function clearPlatformSettingsCache() {
  cached = null;
  cachedAt = 0;
}

export async function getPlatformSettings({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const settings = await PlatformSettings.findOne({ key: "platform" }).lean();
  cached = settings || {};
  cachedAt = Date.now();
  return cached;
}

function envMinutes(value) {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  return { s: amount / 60, m: amount, h: amount * 60, d: amount * 1440 }[unit];
}

// The values in force: the saved setting, else the environment default.
export function effectiveSettings(settings = {}, env = process.env) {
  const policy = settings.passwordPolicy || {};
  const session = settings.session || {};
  return {
    passwordPolicy: {
      minLength: policy.minLength || 10,
      expiryDays: policy.expiryDays || 0,
      maxFailedAttempts: policy.maxFailedAttempts || Math.max(1, Number(env.LOGIN_MAX_FAILED_ATTEMPTS) || 5),
      lockoutMinutes: policy.lockoutMinutes || Math.max(1, Number(env.LOGIN_LOCKOUT_MINUTES) || 15)
    },
    session: {
      userMinutes: session.userMinutes || Math.round(envMinutes(env.JWT_EXPIRES_IN || "8h") || 480),
      superAdminMinutes: session.superAdminMinutes || SUPER_ADMIN_DEFAULT_SESSION_MINUTES
    },
    maintenance: { enabled: Boolean(settings.maintenance?.enabled), message: settings.maintenance?.message || "" },
    announcement: { enabled: Boolean(settings.announcement?.enabled), message: settings.announcement?.message || "", tone: settings.announcement?.tone || "info" },
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy
  };
}

export async function currentSettings() {
  return effectiveSettings(await getPlatformSettings());
}

// Token lifetime for a session of this user. The Super Admin's sessions are shorter.
export function sessionLifetime(user, settings) {
  const { session } = effectiveSettings(settings);
  if (user?.role === ROLES.SUPER_ADMIN) return `${session.superAdminMinutes}m`;
  // Without a saved value the environment string is used as-is (e.g. "8h").
  return settings?.session?.userMinutes ? `${session.userMinutes}m` : process.env.JWT_EXPIRES_IN || "8h";
}

// The password has outlived the expiry policy (counted from the last change, else from the
// account's creation).
export function passwordExpired(user, settings, now = new Date()) {
  const { expiryDays } = effectiveSettings(settings).passwordPolicy;
  if (!expiryDays || !user) return false;
  const since = user.passwordChangedAt || user.createdAt;
  if (!since) return false;
  return now.getTime() - new Date(since).getTime() > expiryDays * 86400000;
}

export function assertPasswordPolicy(password, settings, field = "password") {
  const { minLength } = effectiveSettings(settings).passwordPolicy;
  const value = typeof password === "string" ? password : "";
  if (value.length < minLength || value.length > 72) {
    throw new AppError(422, "The password does not meet the password policy: check its minimum length (at most 72 characters).", { field, minLength }, ERROR_CODES.VALIDATION_ERROR);
  }
}

// What the sign-in page and every signed-in screen may show before (or without) a session.
export async function publicPlatformStatus() {
  const { maintenance, announcement, passwordPolicy } = await currentSettings();
  return {
    maintenance,
    announcement: announcement.enabled && announcement.message ? announcement : { enabled: false },
    passwordMinLength: passwordPolicy.minLength
  };
}

function boundedNumber(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  const [min, max] = SETTINGS_LIMITS[name];
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AppError(422, "Each setting must be a whole number within its allowed range.", { field: name, min, max }, ERROR_CODES.VALIDATION_ERROR);
  }
  return number;
}

function text(value, field) {
  const result = String(value ?? "").trim();
  if (result.length > 500) throw new AppError(422, "Messages can have at most 500 characters.", { field }, ERROR_CODES.VALIDATION_ERROR);
  return result;
}

export async function updatePlatformSettings(body, { user, req }) {
  const before = await PlatformSettings.findOne({ key: "platform" }).lean();
  const policy = body.passwordPolicy || {};
  const session = body.session || {};
  const next = {
    passwordPolicy: {
      minLength: boundedNumber(policy.minLength, "minLength"),
      expiryDays: boundedNumber(policy.expiryDays, "expiryDays"),
      maxFailedAttempts: boundedNumber(policy.maxFailedAttempts, "maxFailedAttempts"),
      lockoutMinutes: boundedNumber(policy.lockoutMinutes, "lockoutMinutes")
    },
    session: {
      userMinutes: boundedNumber(session.userMinutes, "userMinutes"),
      superAdminMinutes: boundedNumber(session.superAdminMinutes, "superAdminMinutes")
    },
    maintenance: {
      enabled: Boolean(body.maintenance?.enabled),
      message: text(body.maintenance?.message, "maintenance.message")
    },
    announcement: {
      enabled: Boolean(body.announcement?.enabled),
      message: text(body.announcement?.message, "announcement.message"),
      tone: body.announcement?.tone === "warning" ? "warning" : "info"
    },
    updatedBy: user._id
  };
  if (next.announcement.enabled && !next.announcement.message) {
    throw new AppError(422, "Write the announcement before turning it on.", { field: "announcement.message" }, ERROR_CODES.VALIDATION_ERROR);
  }
  const saved = await PlatformSettings.findOneAndUpdate({ key: "platform" }, { $set: next }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean();
  clearPlatformSettingsCache();
  const summary = (value) => value ? { passwordPolicy: value.passwordPolicy, session: value.session, maintenance: value.maintenance, announcement: value.announcement } : undefined;
  await recordAudit({ entityType: "PlatformSettings", entity: saved._id, action: "PLATFORM_SETTINGS_UPDATED", user, req, module: "SUPER_ADMIN", oldValues: summary(before), newValues: summary(saved) });
  if (Boolean(before?.maintenance?.enabled) !== next.maintenance.enabled) {
    await recordAudit({ entityType: "PlatformSettings", entity: saved._id, action: next.maintenance.enabled ? "MAINTENANCE_STARTED" : "MAINTENANCE_ENDED", user, req, module: "SUPER_ADMIN", message: next.maintenance.message || undefined });
  }
  return effectiveSettings(saved);
}
