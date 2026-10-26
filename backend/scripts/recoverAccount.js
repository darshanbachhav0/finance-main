import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import User from "../src/models/User.js";
import { accountStatus, recoverAccount } from "../src/services/accountRecoveryService.js";

// Recovers an account that cannot sign in (inactive, or the password is lost), from your own
// computer, against the production database. No server shell needed (Render free has none).
//
//   1. Copy MONGODB_URI from Render -> Environment (keep it private).
//   2. Show the account's status only (changes nothing):
//        npm run account:recover -- --dni=10000001
//   3. Recover it: --activate if it is inactive, --reset-password for a new temporary password
//      (which must be changed at the next sign-in):
//        npm run account:recover -- --dni=10000001 --apply --reset-password
//
// PowerShell:  $env:MONGODB_URI="mongodb+srv://..."; npm run account:recover -- --dni=10000001
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);
const dni = argument("dni");

async function main() {
  if (!dni) throw new Error("Pass the DNI: npm run account:recover -- --dni=<DNI>");
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI to the production database first (Render -> Environment -> MONGODB_URI).");
  await connectDB();
  if (!flag("apply")) {
    const status = accountStatus(await User.findOne({ dni: String(dni).trim() }).lean());
    if (!status) {
      console.log(`No user has DNI ${dni} in database "${mongoose.connection.name}".`);
      const admins = await User.find({ role: "Admin" }).select("name dni active").lean();
      console.log(admins.length ? `Administrators in this database: ${admins.map((user) => `${user.name} (DNI ${user.dni || "-"}${user.active === false ? ", inactive" : ""})`).join("; ")}` : "This database has no administrator account.");
      return;
    }
    console.log(JSON.stringify(status, null, 2));
    if (!status.active) console.log("The account is INACTIVE: every sign-in fails. Add --apply --activate.");
    console.log("Nothing was changed. Add --apply with --reset-password and/or --activate to recover the account.");
    return;
  }
  const result = await recoverAccount({ dni, activate: flag("activate"), resetPassword: flag("reset-password") });
  if (!result.found) { console.log(`No user has DNI ${dni} in database "${mongoose.connection.name}".`); process.exitCode = 1; return; }
  console.log(`Recovered ${result.after.name} (${result.after.role}) in database "${mongoose.connection.name}"${flag("activate") ? ": active" : ""}.`);
  if (!result.after.active) console.log("Note: the account is still INACTIVE. Run again with --activate to allow sign-in.");
  if (result.password) console.log(`\nTemporary password (shown once; you will be asked to change it at sign-in):\n${result.password}\n`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
