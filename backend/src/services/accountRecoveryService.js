import crypto from "node:crypto";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import { recordAudit } from "./auditService.js";

// Break-glass recovery for an account nobody can sign in to (e.g. the only administrator is locked
// out, and the host has no shell). Run by whoever holds the database credentials, from their own
// computer: npm run account:recover (scripts/recoverAccount.js). Every change is audited.

export function temporaryPassword() {
  // 16 random URL-safe characters plus a fixed tail, comfortably above the 10-character minimum.
  return `${crypto.randomBytes(12).toString("base64url")}-Uma7`;
}

export function accountStatus(user, now = new Date()) {
  if (!user) return null;
  const locked = Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > now.getTime());
  return {
    name: user.name,
    dni: user.dni || null,
    email: user.email || null,
    role: user.role,
    active: user.active !== false,
    locked,
    lockedUntil: locked ? new Date(user.lockedUntil).toISOString() : null,
    failedLoginAttempts: user.failedLoginAttempts || 0,
    passwordResetRequired: Boolean(user.passwordResetRequired)
  };
}

// Clears the sign-in lock; optionally reactivates the account and/or sets a new temporary password
// (the person must change it at the next sign-in, and every existing session is signed out).
export async function recoverAccount({ dni, activate = false, resetPassword = false, now = new Date() }) {
  const identifier = String(dni || "").trim();
  if (!identifier) throw new Error("Pass the person's DNI.");
  const user = await User.findOne({ dni: identifier });
  if (!user) return { found: false, dni: identifier };
  const before = accountStatus(user, now);
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  if (activate) user.active = true;
  let password;
  if (resetPassword) {
    password = temporaryPassword();
    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordResetRequired = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  await user.save();
  await recordAudit({
    entityType: "User", entity: user, action: "ACCOUNT_RECOVERED", module: "AUTH",
    message: "Sign-in lock cleared from the database recovery command.",
    oldValues: { active: before.active, locked: before.locked },
    newValues: { active: user.active !== false, locked: false, passwordReset: Boolean(resetPassword) }
  });
  return { found: true, before, after: accountStatus(user, now), password };
}
