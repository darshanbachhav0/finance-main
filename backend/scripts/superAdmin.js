import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { createSuperAdmin, listSuperAdmins, resetSuperAdminTwoFactor } from "../src/services/superAdminAccountService.js";

// Super Admin accounts exist only through this command (never from the web app), at most two.
// Run it from your own computer against the target database, like account:recover:
//
//   List:            npm run superadmin:list
//   Create:          npm run superadmin:create -- --dni=12345678 --name="Ana Torres" [--email=ana@uma.edu.pe]
//   Lost phone:      npm run superadmin:reset-2fa -- --dni=12345678
//
// Create prints a temporary password once; the first sign-in asks to change it and to set up the
// authenticator app. A locked Super Admin is unlocked with npm run account:recover.
//
// PowerShell:  $env:MONGODB_URI="mongodb+srv://..."; npm run superadmin:list
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const command = process.argv[2];

async function main() {
  if (!["create", "list", "reset-2fa"].includes(command)) throw new Error("Use one of: create, list, reset-2fa.");
  if (!process.env.MONGODB_URI && process.env.NODE_ENV === "production") throw new Error("Set MONGODB_URI to the target database first.");
  await connectDB();
  const database = mongoose.connection.name;
  if (command === "list") {
    const rows = await listSuperAdmins();
    console.log(rows.length ? rows.map((row) => `${row.name} (DNI ${row.dni}${row.active ? "" : ", inactive"}${row.twoFactorEnabled ? ", authenticator set up" : ", authenticator pending"})`).join("\n") : `No Super Admin account in database "${database}".`);
    return;
  }
  if (command === "create") {
    const result = await createSuperAdmin({ dni: argument("dni"), name: argument("name"), email: argument("email") });
    console.log(`Created Super Admin ${result.user.name} (DNI ${result.user.dni}) in database "${database}".`);
    console.log(`\nTemporary password (shown once; change it at the first sign-in, then set up the authenticator app):\n${result.password}\n`);
    return;
  }
  const user = await resetSuperAdminTwoFactor({ dni: argument("dni") });
  console.log(`Authenticator removed for ${user.name} (DNI ${user.dni}) in database "${database}". They set it up again at their next sign-in.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
