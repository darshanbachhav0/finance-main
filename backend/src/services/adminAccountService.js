import bcrypt from "bcrypt";
import User from "../models/User.js";
import { ROLES } from "../utils/constants.js";
import { temporaryPassword } from "./accountRecoveryService.js";
import { recordAudit } from "./auditService.js";

// Break-glass administrator accounts from the server (scripts/adminAccount.js): the first
// administrator of a new database, or a new one when nobody can sign in as administrator. Day to
// day, administrators assign the Admin role from Administración > Empleados. Every change is
// audited as a system action.
const isAdmin = { $or: [{ role: ROLES.ADMIN }, { roles: ROLES.ADMIN }] };

export async function listAdministrators() {
  const rows = await User.find(isAdmin).select("name dni email active twoFactor.enabled").sort({ name: 1 }).lean();
  return rows.map((row) => ({ name: row.name, dni: row.dni, email: row.email, active: row.active !== false, twoFactorEnabled: Boolean(row.twoFactor?.enabled) }));
}

export async function createAdministrator({ dni, name, email }) {
  const cleanDni = String(dni || "").trim();
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase() || undefined;
  if (!/^\d{8}$/.test(cleanDni)) throw new Error("Pass an 8-digit DNI: --dni=12345678");
  if (!cleanName) throw new Error('Pass the name: --name="Ana Torres"');
  if (await User.exists({ dni: cleanDni })) throw new Error(`A user with DNI ${cleanDni} already exists. Give that employee the Admin role from Administración > Empleados instead.`);
  if (cleanEmail && await User.exists({ email: cleanEmail })) throw new Error(`A user with email ${cleanEmail} already exists.`);
  const password = temporaryPassword();
  const user = await User.create({
    name: cleanName,
    dni: cleanDni,
    email: cleanEmail,
    role: ROLES.ADMIN,
    area: "Administración",
    active: true,
    passwordHash: await bcrypt.hash(password, 12),
    passwordResetRequired: true,
    passwordChangedAt: new Date(),
    permissions: []
  });
  await recordAudit({ entityType: "User", entity: user, action: "ADMIN_CREATED", module: "USER_ADMIN", message: "Created from the server command.", newValues: { name: user.name, dni: user.dni, email: user.email } });
  return { user, password };
}

// For an administrator who lost their phone: removes the authenticator so it is set up again at
// the next sign-in, and ends every session.
export async function resetAdministratorTwoFactor({ dni }) {
  const user = await User.findOne({ dni: String(dni || "").trim(), ...isAdmin });
  if (!user) throw new Error(`No administrator has DNI ${dni}.`);
  user.twoFactor = { enabled: false };
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await recordAudit({ entityType: "User", entity: user, action: "TWO_FACTOR_RESET", module: "USER_ADMIN", message: "Authenticator removed from the server command.", newValues: { twoFactorEnabled: false, sessionsRevoked: true } });
  return user;
}
