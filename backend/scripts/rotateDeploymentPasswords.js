import "dotenv/config";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "../src/config/db.js";
import User from "../src/models/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credentialsPath = path.resolve(__dirname, "..", "..", "deployment-credentials.txt");

function createPassword() {
  return `${randomBytes(18).toString("base64url")}!aA7`;
}

await connectDB();

try {
  const users = await User.find().sort({ role: 1, email: 1 });
  if (!users.length) throw new Error("No users were found. Seed or create an administrator first.");

  const credentials = [];
  for (const user of users) {
    const password = createPassword();
    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    credentials.push({ name: user.name, role: user.role, email: user.email, password });
  }

  const lines = [
    "ERP Financial Control - private deployment credentials",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Keep this file private. Use Admin > Users to replace these temporary passwords.",
    ""
  ];

  credentials.forEach((credential) => {
    lines.push(`${credential.role} | ${credential.name}`);
    lines.push(`Email: ${credential.email}`);
    lines.push(`Password: ${credential.password}`);
    lines.push("");
  });

  await writeFile(credentialsPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Rotated ${credentials.length} user passwords.`);
  console.log(`Private credentials written to ${credentialsPath}`);
} finally {
  await User.db.close();
}
