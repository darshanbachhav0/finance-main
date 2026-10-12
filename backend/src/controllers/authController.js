import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { needsTwoFactorSetup } from "../middleware/auth.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { ADMINISTRATOR_ROLES, ERROR_CODES, REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { clientIp, recordAudit } from "../services/auditService.js";
import { endExpiredLeaves } from "../services/userLeaveService.js";
import { assertPasswordPolicy, effectiveSettings, getPlatformSettings, passwordExpired, publicPlatformStatus, sessionLifetime } from "../services/platformSettingsService.js";
import { decryptSecret, encryptSecret, generateSecret, otpauthUri, verifyTotp } from "../services/twoFactorService.js";

export async function sessionUser(user, settings) {
  // Recompute on session refresh; never trust a client-supplied or stored capability.
  const [team, pendingApproval, platform] = await Promise.all([
    User.exists({ jefe: user._id, active: true, _id: { $ne: user._id } }),
    // An approval step assigned to this person right now (e.g. covering for a jefe on leave).
    FinancialRequest.exists({
      status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] },
      approvalRouteSnapshot: { $elemMatch: { approverUser: user._id, status: "PENDING" } }
    }),
    settings ? settings : getPlatformSettings()
  ]);
  const expired = passwordExpired(user, platform);
  return {
    ...user.toJSON(),
    // An expired password is changed the same way as an initial one.
    passwordResetRequired: Boolean(user.passwordResetRequired || expired),
    passwordExpired: expired,
    twoFactorSetupRequired: needsTwoFactorSetup(user),
    hasTeam: Boolean(team),
    hasPendingApprovals: Boolean(pendingApproval)
  };
}

function signToken(user, settings) {
  return jwt.sign({ id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 }, getJwtSecret(), {
    expiresIn: sessionLifetime(user, settings)
  });
}

// Every response that issues a token also says when it expires, so the client can warn the user
// before the session ends.
function sessionResponse(token, user) {
  const { exp } = jwt.decode(token) || {};
  return { token, expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined, user };
}

async function issueSession(user) {
  const settings = await getPlatformSettings();
  return sessionResponse(signToken(user, settings), await sessionUser(user, settings));
}

// Per-account lockout: after maxFailedAttempts consecutive failures the account refuses sign-in
// for lockoutMinutes, whatever IP the attempts come from (the route's rate limiter only throttles
// per IP). Platform settings override the LOGIN_MAX_FAILED_ATTEMPTS / LOGIN_LOCKOUT_MINUTES defaults.
export function loginLockoutPolicy(env = process.env, settings = {}) {
  const { maxFailedAttempts, lockoutMinutes } = effectiveSettings(settings, env).passwordPolicy;
  return { maxAttempts: maxFailedAttempts, lockoutMinutes };
}

// Fixed text so the frontend can translate it; details.lockedUntil carries the time.
function lockedMessage() {
  return "This account is temporarily locked after repeated failed sign-in attempts. Try again later.";
}

async function auditLogin(action, { req, user, identifier, reason, blocked = false, extra }) {
  try {
    await recordAudit({
      entityType: "User",
      entity: user?._id,
      action,
      user: user ? { _id: user._id, name: user.name, role: user.role } : undefined,
      req,
      module: "AUTH",
      blocked,
      blockReason: blocked ? reason : undefined,
      message: reason,
      // Never the password; the identifier is what was typed, so a typo stays attributable.
      newValues: { identifier: identifier ? String(identifier).slice(0, 120) : undefined, ...extra }
    });
  } catch (error) {
    console.error("Sign-in audit failed", error?.message || error);
  }
}

function assertNotLocked(user) {
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError(429, lockedMessage(), { lockedUntil: user.lockedUntil }, "ACCOUNT_LOCKED");
  }
}

// Counts a failed password or authenticator code toward the lockout. Throws when the account
// locks; otherwise the caller throws its own error.
async function registerFailedSignIn(user, { req, identifier, reason, action = "LOGIN_FAILED" }) {
  const { maxAttempts, lockoutMinutes } = loginLockoutPolicy(process.env, await getPlatformSettings());
  const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginAttempts: 1 } }, { new: true, projection: { failedLoginAttempts: 1 } });
  if ((updated?.failedLoginAttempts || 0) >= maxAttempts) {
    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000);
    await User.updateOne({ _id: user._id }, { $set: { lockedUntil, failedLoginAttempts: 0 } });
    await auditLogin(action, { req, user, identifier, reason, blocked: true });
    await auditLogin("ACCOUNT_LOCKED", { req, user, identifier, reason: `Locked for ${lockoutMinutes} minutes after ${maxAttempts} failed sign-ins.`, blocked: true });
    throw new AppError(429, lockedMessage(), { lockedUntil }, "ACCOUNT_LOCKED");
  }
}

async function completeSignIn(user, { req, identifier, method }) {
  await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: clientIp(req) } });
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await auditLogin("LOGIN_SUCCEEDED", { req, user, identifier, extra: method ? { method } : undefined });
  return issueSession(user);
}

// During maintenance only administrators sign in.
async function assertNotInMaintenance(user) {
  const settings = await getPlatformSettings();
  if (settings.maintenance?.enabled && !ADMINISTRATOR_ROLES.includes(user.role)) {
    throw new AppError(503, "The platform is in maintenance. Try again later.", { message: settings.maintenance.message || undefined }, ERROR_CODES.MAINTENANCE_MODE);
  }
}

// Second step of a sign-in with an authenticator app: proves the password was right, valid for
// five minutes, and dies with the session version like any token.
const CHALLENGE_PURPOSE = "two-factor-sign-in";

function signChallenge(user) {
  return jwt.sign({ id: user._id, purpose: CHALLENGE_PURPOSE, tokenVersion: user.tokenVersion || 0 }, getJwtSecret(), { expiresIn: "5m" });
}

export const login = asyncHandler(async (req, res) => {
  const { dni, email, password } = req.body;
  if (typeof password !== "string" || !password || (!dni && !email)) throw new AppError(400, "DNI and password are required.");

  // DNI is the login identifier going forward. The email fallback exists only
  // for one transition release so already-issued frontend builds keep working;
  // remove it once every client sends dni.
  const identifier = dni ? String(dni).trim() : String(email).toLowerCase();
  const user = dni
    ? await User.findOne({ dni: identifier })
    : await User.findOne({ email: identifier });

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await auditLogin("LOGIN_LOCKED", { req, user, identifier, reason: "Account temporarily locked after repeated failed sign-ins.", blocked: true });
    assertNotLocked(user);
  }

  if (!user || !user.active || !(await user.comparePassword(password))) {
    const reason = !user ? "Unknown account." : !user.active ? "Inactive account." : "Wrong password.";
    if (user) await registerFailedSignIn(user, { req, identifier, reason });
    await auditLogin("LOGIN_FAILED", { req, user, identifier, reason, blocked: true });
    throw new AppError(401, "Invalid credentials.");
  }

  await assertNotInMaintenance(user);
  if (user.twoFactor?.enabled) {
    await auditLogin("LOGIN_PASSWORD_VERIFIED", { req, user, identifier, extra: { awaiting: "TOTP" } });
    res.json({ twoFactorRequired: true, challengeToken: signChallenge(user) });
    return;
  }
  res.json(await completeSignIn(user, { req, identifier }));
});

export const loginTwoFactor = asyncHandler(async (req, res) => {
  const { challengeToken, code } = req.body || {};
  let decoded;
  try {
    decoded = jwt.verify(String(challengeToken || ""), getJwtSecret());
  } catch {
    throw new AppError(401, "The sign-in step expired. Enter your DNI and password again.", undefined, ERROR_CODES.TWO_FACTOR_INVALID);
  }
  if (decoded.purpose !== CHALLENGE_PURPOSE) throw new AppError(401, "The sign-in step expired. Enter your DNI and password again.", undefined, ERROR_CODES.TWO_FACTOR_INVALID);
  const user = await User.findById(decoded.id);
  if (!user || !user.active || (decoded.tokenVersion || 0) !== (user.tokenVersion || 0) || !user.twoFactor?.enabled) {
    throw new AppError(401, "The sign-in step expired. Enter your DNI and password again.", undefined, ERROR_CODES.TWO_FACTOR_INVALID);
  }
  assertNotLocked(user);
  const step = verifyTotp(decryptSecret(user.twoFactor.secret), code, { lastUsedStep: user.twoFactor.lastUsedStep });
  if (step === null) {
    await registerFailedSignIn(user, { req, identifier: user.dni, reason: "Wrong authenticator code.", action: "TWO_FACTOR_FAILED" });
    await auditLogin("TWO_FACTOR_FAILED", { req, user, identifier: user.dni, reason: "Wrong authenticator code.", blocked: true });
    throw new AppError(401, "The authenticator code is not valid. Check the time on your phone and try again.", undefined, ERROR_CODES.TWO_FACTOR_INVALID);
  }
  await assertNotInMaintenance(user);
  // A used code (and every older one) cannot be replayed.
  await User.updateOne({ _id: user._id }, { $set: { "twoFactor.lastUsedStep": step } });
  res.json(await completeSignIn(user, { req, identifier: user.dni, method: "TOTP" }));
});

// Enrolment, step 1: a new secret for the authenticator app. It only takes effect once a code
// from the app confirms it (step 2), so a half-finished enrolment never locks anyone out.
export const setupTwoFactor = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN) throw new AppError(403, "Authenticator sign-in is available for the Super Admin account.", undefined, ERROR_CODES.FORBIDDEN);
  if (req.user.twoFactor?.enabled) throw new AppError(409, "Your authenticator app is already set up.", undefined, ERROR_CODES.CONFLICT);
  const secret = generateSecret();
  await User.updateOne({ _id: req.user._id }, { $set: { "twoFactor.pendingSecret": encryptSecret(secret) } });
  res.json({ data: { secret, otpauthUri: otpauthUri(secret, req.user.dni || req.user.name) } });
});

// Enrolment, step 2: a code from the app turns authenticator sign-in on. Every other session of
// the account ends; the caller gets a fresh one.
export const enableTwoFactor = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.twoFactor?.enabled) throw new AppError(409, "Your authenticator app is already set up.", undefined, ERROR_CODES.CONFLICT);
  const secret = decryptSecret(user.twoFactor?.pendingSecret);
  if (!secret) throw new AppError(409, "Start the authenticator setup again.", undefined, ERROR_CODES.CONFLICT);
  const step = verifyTotp(secret, req.body?.code);
  if (step === null) throw new AppError(422, "The authenticator code is not valid. Check the time on your phone and try again.", { field: "code" }, ERROR_CODES.TWO_FACTOR_INVALID);
  user.twoFactor = { enabled: true, secret: user.twoFactor.pendingSecret, pendingSecret: undefined, enabledAt: new Date(), lastUsedStep: step };
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "TWO_FACTOR_ENABLED", user, req, module: "AUTH", newValues: { twoFactorEnabled: true, sessionsRevoked: true } });
  res.json(await issueSession(user));
});

// Public: maintenance notice and announcement banner for the sign-in page.
export const platformStatus = asyncHandler(async (_req, res) => {
  res.json({ data: await publicPlatformStatus() });
});

// Extends a live session. protect() has already verified the current token (signature, expiry,
// active account, tokenVersion), so an expired or revoked token never reaches this handler. The
// new token keeps the same tokenVersion: signing out still revokes it like any other.
export const refresh = asyncHandler(async (req, res) => {
  const session = await issueSession(req.user);
  await recordAudit({ entityType: "User", entity: req.user._id, action: "SESSION_REFRESHED", user: req.user, req, module: "AUTH", newValues: { expiresAt: session.expiresAt } });
  res.json(session);
});

// Ends the session server-side: bumping tokenVersion invalidates every token issued so far for
// this account (protect() compares it on each request), not just the caller's copy.
export const logout = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  await recordAudit({ entityType: "User", entity: req.user._id, action: "LOGOUT", user: req.user, req, module: "AUTH", newValues: { sessionsRevoked: true } });
  res.json({ success: true });
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
    passwordChangedAt: new Date(),
    area,
    role: userCount === 0 ? ROLES.ADMIN : ROLES.SOLICITOR
  });

  res.status(201).json(await issueSession(user));
});

export const me = asyncHandler(async (req, res) => {
  // A leave whose last day has passed ends when the person opens the app.
  const { ended } = await endExpiredLeaves({ userIds: [req.user._id] });
  res.json({ user: await sessionUser(ended ? await User.findById(req.user._id) : req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const settings = await getPlatformSettings();
  if (typeof currentPassword !== "string") throw new AppError(422, "Use a password between 10 and 72 characters and provide your current password.");
  assertPasswordPolicy(newPassword, settings, "newPassword");
  const user = await User.findById(req.user._id);
  if (!user || !(await user.comparePassword(currentPassword))) throw new AppError(401, "The current password is incorrect.");
  if (currentPassword === newPassword) throw new AppError(422, "Choose a different password.");
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordResetRequired = false;
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "PASSWORD_CHANGED", user, req, module: "AUTH", newValues: { passwordResetRequired: false, sessionsRevoked: true } });
  res.json(sessionResponse(signToken(user, settings), await sessionUser(user, settings)));
});
