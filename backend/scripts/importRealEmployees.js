import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { ROLES } from "../src/utils/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = process.argv[2];
if (!SOURCE_FILE) {
  console.error("Usage: node scripts/importRealEmployees.js <path-to-list.txt>");
  process.exit(1);
}

function parseEntries(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const nameLine = lines[i];
    const match = nameLine.match(/^(.+?)\s*\|\s*DNI:\s*(\d+)\s*$/i);
    if (!match) continue;
    const passwordLine = lines[i + 1] || "";
    const passwordMatch = passwordLine.match(/^Password:\s*(\S+)\s*$/i);
    if (!passwordMatch) {
      console.warn(`Skipping "${match[1]}" (DNI ${match[2]}): no password line found after it.`);
      continue;
    }
    entries.push({ name: match[1].trim(), dni: match[2].trim(), password: passwordMatch[1] });
  }
  return entries;
}

function emailForDni(dni) {
  return `u${dni}@uma.edu.pe`;
}

async function main() {
  const dbName = process.env.MONGODB_DBNAME || "erp_financial_system";
  const uri = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;
  if (!/erp_financial_system|localhost|127\.0\.0\.1/.test(uri)) {
    console.error(`Refusing to run against non-local URI: ${uri}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(SOURCE_FILE), "utf8");
  const entries = parseEntries(raw);
  console.log(`Parsed ${entries.length} employee entries from ${SOURCE_FILE}`);

  const dniCounts = new Map();
  for (const entry of entries) dniCounts.set(entry.dni, (dniCounts.get(entry.dni) || 0) + 1);
  const duplicateDnis = [...dniCounts.entries()].filter(([, count]) => count > 1);
  if (duplicateDnis.length) {
    console.warn("Duplicate DNIs in source list (last occurrence wins):", duplicateDnis.map(([dni]) => dni).join(", "));
  }

  await mongoose.connect(uri);
  console.log(`Connected to ${mongoose.connection.name}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const existing = await User.findOne({ dni: entry.dni });
    const passwordHash = await bcrypt.hash(entry.password, 12);

    if (existing) {
      existing.name = entry.name;
      existing.passwordHash = passwordHash;
      existing.passwordResetRequired = false;
      if (!existing.role) existing.role = ROLES.SOLICITOR;
      await existing.save();
      updated++;
      continue;
    }

    try {
      await User.create({
        name: entry.name,
        dni: entry.dni,
        email: emailForDni(entry.dni),
        passwordHash,
        passwordResetRequired: false,
        role: ROLES.SOLICITOR,
        area: "General",
        active: true
      });
      created++;
    } catch (err) {
      console.error(`Failed to create ${entry.name} (DNI ${entry.dni}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`Done. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Total processed: ${entries.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
