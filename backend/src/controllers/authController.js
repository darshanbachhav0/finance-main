import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import FinancialRequest from "../models/FinancialRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getJwtSecret } from "../config/secrets.js";
import { AppError } from "../utils/AppError.js";
import { REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { recordAudit } from "../services/auditService.js";
import { endExpiredLeaves } from "../services/userLeaveService.js";

export async function sessionUser(user) {
  // Recompute on session refresh; never trust a client-supplied or stored capability.
  const [team, pendingApproval] = await Promise.all([
    User.exists({ jefe: user._id, active: true, _id: { $ne: user._id } }),
    // An approval step assigned to this person right now (e.g. covering for a jefe on leave).
    FinancialRequest.exists({
      status: { $in: [REQUEST_STATUS.PENDING_APPROVAL, REQUEST_STATUS.DIRECTOR_APPROVED, REQUEST_STATUS.VICE_RECTOR_APPROVED] },
      approvalRouteSnapshot: { $elemMatch: { approverUser: user._id, status: "PENDING" } }
    })
  ]);
  return { ...user.toJSON(), hasTeam: Boolean(team), hasPendingApprovals: Boolean(pendingApproval) };
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h"
  });
}

// Every response that issues a token also says when it expires, so the client can warn the user
// before the session ends.
function sessionResponse(token, user) {
  const { exp } = jwt.decode(token) || {};
  return { token, expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined, user };
}

// Per-account lockout: after LOGIN_MAX_FAILED_ATTEMPTS consecutive failures the account refuses
// sign-in for LOGIN_LOCKOUT_MINUTES, whatever IP the attempts come from (the route's rate limiter
// only throttles per IP).
export function loginLockoutPolicy(env = process.env) {
  return {
    maxAttempts: Math.max(1, Number(env.LOGIN_MAX_FAILED_ATTEMPTS) || 5),
    lockoutMinutes: Math.max(1, Number(env.LOGIN_LOCKOUT_MINUTES) || 15)
  };
}

// Fixed text so the frontend can translate it; details.lockedUntil carries the time.
function lockedMessage() {
  return "This account is temporarily locked after repeated failed sign-in attempts. Try again later.";
}

async function auditLogin(action, { req, user, identifier, reason, blocked = false }) {
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
      newValues: { identifier: identifier ? String(identifier).slice(0, 120) : undefined }
    });
  } catch (error) {
    console.error("Sign-in audit failed", error?.message || error);
  }
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
    throw new AppError(429, lockedMessage(), { lockedUntil: user.lockedUntil }, "ACCOUNT_LOCKED");
  }

  if (!user || !user.active || !(await user.comparePassword(password))) {
    const reason = !user ? "Unknown account." : !user.active ? "Inactive account." : "Wrong password.";
    if (user) {
      const { maxAttempts, lockoutMinutes } = loginLockoutPolicy();
      const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginAttempts: 1 } }, { new: true, projection: { failedLoginAttempts: 1 } });
      if ((updated?.failedLoginAttempts || 0) >= maxAttempts) {
        const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000);
        await User.updateOne({ _id: user._id }, { $set: { lockedUntil, failedLoginAttempts: 0 } });
        await auditLogin("LOGIN_FAILED", { req, user, identifier, reason, blocked: true });
        await auditLogin("ACCOUNT_LOCKED", { req, user, identifier, reason: `Locked for ${lockoutMinutes} minutes after ${maxAttempts} failed sign-ins.`, blocked: true });
        throw new AppError(429, lockedMessage(), { lockedUntil }, "ACCOUNT_LOCKED");
      }
    }
    await auditLogin("LOGIN_FAILED", { req, user, identifier, reason, blocked: true });
    throw new AppError(401, "Invalid credentials.");
  }

  if (user.failedLoginAttempts || user.lockedUntil) {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockedUntil: null } });
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
  }
  await auditLogin("LOGIN_SUCCEEDED", { req, user, identifier });
  res.json(sessionResponse(signToken(user), await sessionUser(user)));
});

// Extends a live session. protect() has already verified the current token (signature, expiry,
// active account, tokenVersion), so an expired or revoked token never reaches this handler. The
// new token keeps the same tokenVersion: signing out still revokes it like any other.
export const refresh = asyncHandler(async (req, res) => {
  const session = sessionResponse(signToken(req.user), await sessionUser(req.user));
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
    area,
    role: userCount === 0 ? ROLES.ADMIN : ROLES.SOLICITOR
  });

  res.status(201).json(sessionResponse(signToken(user), await sessionUser(user)));
});

export const me = asyncHandler(async (req, res) => {
  // A leave whose last day has passed ends when the person opens the app.
  const { ended } = await endExpiredLeaves({ userIds: [req.user._id] });
  res.json({ user: await sessionUser(ended ? await User.findById(req.user._id) : req.user) });
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
  res.json(sessionResponse(signToken(user), await sessionUser(user)));
});
