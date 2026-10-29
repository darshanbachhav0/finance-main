import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { createAdministrator, listAdministrators, resetAdministratorTwoFactor } from "../src/services/adminAccountService.js";

// Break-glass administrator accounts from the server (the web app assigns the Admin role day to
// day). Run it from your own computer against the target database, like account:recover:
//
//   List:            npm run admin:list
//   Create:          npm run admin:create -- --dni=12345678 --name="Ana Torres" [--email=ana@uma.edu.pe]
//   Lost phone:      npm run admin:reset-2fa -- --dni=12345678
//
// Create prints a temporary password once; the first sign-in asks to change it. An administrator
// who lost the password recovers it with npm run account:recover.
//
// PowerShell:  $env:MONGODB_URI="mongodb+srv://..."; npm run admin:list
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const command = process.argv[2];

async function main() {
  if (!["create", "list", "reset-2fa"].includes(command)) throw new Error("Use one of: create, list, reset-2fa.");
  if (!process.env.MONGODB_URI && process.env.NODE_ENV === "production") throw new Error("Set MONGODB_URI to the target database first.");
  await connectDB();
  const database = mongoose.connection.name;
  if (command === "list") {
    const rows = await listAdministrators();
    console.log(rows.length ? rows.map((row) => `${row.name} (DNI ${row.dni}${row.active ? "" : ", inactive"}${row.twoFactorEnabled ? ", authenticator set up" : ", authenticator pending"})`).join("\n") : `No administrator account in database "${database}".`);
    return;
  }
  if (command === "create") {
    const result = await createAdministrator({ dni: argument("dni"), name: argument("name"), email: argument("email") });
    console.log(`Created administrator ${result.user.name} (DNI ${result.user.dni}) in database "${database}".`);
    console.log(`\nTemporary password (shown once; change it at the first sign-in):\n${result.password}\n`);
    return;
  }
  const user = await resetAdministratorTwoFactor({ dni: argument("dni") });
  console.log(`Authenticator removed for ${user.name} (DNI ${user.dni}) in database "${database}". They set it up again at their next sign-in.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => undefined));
