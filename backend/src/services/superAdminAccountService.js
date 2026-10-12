import bcrypt from "bcrypt";
import User from "../models/User.js";
import { MAX_SUPER_ADMINS, ROLES } from "../utils/constants.js";
import { temporaryPassword } from "./accountRecoveryService.js";
import { recordAudit } from "./auditService.js";

// Super Admin accounts, managed only from the server (scripts/superAdmin.js). Every change is
// audited as a system action.
export async function listSuperAdmins() {
  const rows = await User.find({ role: ROLES.SUPER_ADMIN }).select("name dni email active twoFactor.enabled").sort({ name: 1 }).lean();
  return rows.map((row) => ({ name: row.name, dni: row.dni, email: row.email, active: row.active !== false, twoFactorEnabled: Boolean(row.twoFactor?.enabled) }));
}

export async function createSuperAdmin({ dni, name, email }) {
  const cleanDni = String(dni || "").trim();
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase() || undefined;
  if (!/^\d{8}$/.test(cleanDni)) throw new Error("Pass an 8-digit DNI: --dni=12345678");
  if (!cleanName) throw new Error('Pass the name: --name="Ana Torres"');
  if (await User.countDocuments({ role: ROLES.SUPER_ADMIN, active: true }) >= MAX_SUPER_ADMINS) {
    throw new Error(`There are already ${MAX_SUPER_ADMINS} active Super Admin accounts, the maximum.`);
  }
  if (await User.exists({ dni: cleanDni })) throw new Error(`A user with DNI ${cleanDni} already exists. The Super Admin needs its own account, separate from any working account.`);
  if (cleanEmail && await User.exists({ email: cleanEmail })) throw new Error(`A user with email ${cleanEmail} already exists.`);
  const password = temporaryPassword();
  const user = await User.create({
    name: cleanName,
    dni: cleanDni,
    email: cleanEmail,
    role: ROLES.SUPER_ADMIN,
    area: "Super Admin",
    active: true,
    passwordHash: await bcrypt.hash(password, 12),
    passwordResetRequired: true,
    passwordChangedAt: new Date(),
    permissions: []
  });
  await recordAudit({ entityType: "User", entity: user, action: "SUPER_ADMIN_CREATED", module: "SUPER_ADMIN", message: "Created from the server command.", newValues: { name: user.name, dni: user.dni, email: user.email } });
  return { user, password };
}

// For a Super Admin who lost their phone: removes the authenticator so it is set up again at the
// next sign-in, and ends every session.
export async function resetSuperAdminTwoFactor({ dni }) {
  const user = await User.findOne({ dni: String(dni || "").trim(), role: ROLES.SUPER_ADMIN });
  if (!user) throw new Error(`No Super Admin has DNI ${dni}.`);
  user.twoFactor = { enabled: false };
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "TWO_FACTOR_RESET", module: "SUPER_ADMIN", message: "Authenticator removed from the server command.", newValues: { twoFactorEnabled: false, sessionsRevoked: true } });
  return user;
}
