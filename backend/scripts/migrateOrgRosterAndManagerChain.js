import "dotenv/config";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same scheme as rotateDeploymentPasswords.js, so every generated initial
// password meets the app's own password-strength rule (min 10 characters).
function createPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}!aA7`;
}

export const MIGRATION_KEY = "2026-09-org-roster-manager-chain";

// Two nicknamed/reordered "JEFE DIRECTO" references in the source roster do
// not exactly match the person's "APELLIDOS Y NOMBRES" spelling, but each has
// exactly one unambiguous candidate in the roster. Resolved automatically and
// logged under report.fuzzyResolutions rather than left for manual review.
const JEFE_NAME_ALIASES = Object.freeze({
  "PAQUILLO": "PAQUILLO TINCO JIMMY MANUEL",
  "GLADYS MORAN": "MORAN PAREDES GLADYS IVONNE"
});

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .trim().replace(/\s+/g, " ").toUpperCase();
}

function buildJefeGraph(rows) {
  // dni -> jefeDni, using the same resolution the migration itself will apply.
  const byName = new Map(rows.map((row) => [normalizeName(row.fullName), row.dni]));
  const graph = new Map();
  for (const row of rows) {
    if (!row.jefeFullName) { graph.set(row.dni, null); continue; }
    const normalized = normalizeName(row.jefeFullName);
    const resolvedName = JEFE_NAME_ALIASES[normalized] || normalized;
    const jefeDni = byName.get(resolvedName) ?? byName.get(normalizeName(resolvedName));
    graph.set(row.dni, jefeDni || null);
  }
  return graph;
}

function findCycle(graph) {
  const state = new Map(); // 0 = unvisited, 1 = in-progress, 2 = done
  for (const start of graph.keys()) {
    if (state.get(start) === 2) continue;
    const path = [];
    let current = start;
    while (current) {
      const status = state.get(current);
      if (status === 1) return path.slice(path.indexOf(current)).concat(current);
      if (status === 2) break;
      state.set(current, 1);
      path.push(current);
      current = graph.get(current);
    }
    for (const node of path) state.set(node, 2);
  }
  return null;
}

// Imports the real org roster (DNI, name, area, job title, direct manager) and
// wires up User.jefe so the manager-chain approval engine can route requests.
// Never touches role/permissions/passwordHash/active on a user that already
// exists (matched by dni) — only $set's roster-sourced descriptive fields.
export async function migrateOrgRoster(db, { apply = false, rosterPath } = {}) {
  const report = {
    mode: apply ? "APPLY" : "DRY_RUN",
    database: db.databaseName,
    scanned: 0,
    changes: [],
    fuzzyResolutions: [],
    manualReview: [],
    conflicts: []
  };
  if (!rosterPath) throw new Error("A --roster=<path.json> file is required.");
  const rows = JSON.parse(await fs.readFile(rosterPath, "utf8"));
  if (!Array.isArray(rows) || !rows.length) throw new Error("Roster file must be a non-empty JSON array.");

  const dnis = new Set(rows.map((row) => row.dni));
  if (dnis.size !== rows.length) throw new Error("Roster contains duplicate DNI values; fix the source file before migrating.");

  const graph = buildJefeGraph(rows);
  const cycle = findCycle(graph);
  if (cycle) throw new Error(`Manager-chain cycle detected and refused: ${cycle.join(" -> ")}`);

  const byName = new Map(rows.map((row) => [normalizeName(row.fullName), row.dni]));
  const users = db.collection("users");
  const manifest = db.collection("orgrostermigrations");
  if (apply) await manifest.createIndex({ migration: 1, dni: 1 }, { unique: true });

  const dniToObjectId = new Map();
  const issuedCredentials = [];

  // Pass 1: upsert by dni. $setOnInsert only takes effect for brand-new users,
  // so an existing account's role/permissions/passwordHash/active are never touched.
  for (const row of rows) {
    report.scanned++;
    const existing = await users.findOne({ dni: row.dni }, { projection: { _id: 1, name: 1, area: 1, jobTitle: 1, organizationalUnit: 1 } });
    const setFields = { name: row.fullName, area: row.area, jobTitle: row.jobTitle, organizationalUnit: row.unidadOrganica };
    if (existing) {
      const changed = Object.entries(setFields).some(([key, value]) => existing[key] !== value);
      if (changed) report.changes.push({ dni: row.dni, name: row.fullName, action: "UPDATE_USER", before: { name: existing.name, area: existing.area, jobTitle: existing.jobTitle, organizationalUnit: existing.organizationalUnit }, after: setFields });
      dniToObjectId.set(row.dni, existing._id);
      if (apply && changed) await users.updateOne({ _id: existing._id }, { $set: setFields });
      continue;
    }
    report.changes.push({ dni: row.dni, name: row.fullName, action: "CREATE_USER", before: null, after: setFields });
    if (!apply) {
      report.manualReview.push({ dni: row.dni, name: row.fullName, reason: "New user will be created with a real initial password; the credential is issued only during --apply and written to a private local file, never printed to this report." });
      continue;
    }
    const initialPassword = createPassword();
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    const insertResult = await users.updateOne(
      { dni: row.dni },
      { $set: setFields, $setOnInsert: { dni: row.dni, role: "Solicitor", active: true, passwordHash, passwordResetRequired: true, createdAt: new Date() } },
      { upsert: true }
    );
    const created = insertResult.upsertedId ? insertResult.upsertedId._id : (await users.findOne({ dni: row.dni }, { projection: { _id: 1 } }))._id;
    dniToObjectId.set(row.dni, created);
    issuedCredentials.push({ dni: row.dni, name: row.fullName, password: initialPassword });
    await manifest.updateOne({ migration: MIGRATION_KEY, dni: row.dni }, { $set: { state: "APPLIED", appliedAt: new Date() } }, { upsert: true });
  }

  // Pass 2: resolve JEFE DIRECTO -> jefe ObjectId. In dry-run mode nothing was
  // actually inserted, so a to-be-created dni is treated as resolvable (it was
  // already validated to exist in the roster and the offline graph is cycle-free)
  // without requiring a real ObjectId.
  for (const row of rows) {
    if (!row.jefeFullName) continue; // the single root of the org chart
    const normalized = normalizeName(row.jefeFullName);
    const resolvedName = JEFE_NAME_ALIASES[normalized] || normalized;
    if (JEFE_NAME_ALIASES[normalized]) {
      report.fuzzyResolutions.push({ jefeNameAsWritten: row.jefeFullName, resolvedTo: JEFE_NAME_ALIASES[normalized], resolvedDni: byName.get(resolvedName) });
    }
    const jefeDni = byName.get(resolvedName);
    if (!jefeDni) {
      report.manualReview.push({ dni: row.dni, name: row.fullName, reason: `Could not resolve "${row.jefeFullName}" to anyone in the roster.` });
      continue;
    }
    if (!apply) continue; // dry-run: resolution already proven possible by the graph/name checks above
    const jefeObjectId = dniToObjectId.get(jefeDni) || (await users.findOne({ dni: jefeDni }, { projection: { _id: 1 } }))?._id;
    if (!jefeObjectId) { report.conflicts.push({ dni: row.dni, reason: `Manager ${jefeDni} was not created/found during apply.` }); continue; }
    const selfId = dniToObjectId.get(row.dni) || (await users.findOne({ dni: row.dni }, { projection: { _id: 1 } }))?._id;
    const result = await users.updateOne({ _id: selfId }, { $set: { jefe: jefeObjectId } });
    if (!result.matchedCount) report.conflicts.push({ dni: row.dni, reason: "User record disappeared between pass 1 and pass 2." });
  }

  if (apply && issuedCredentials.length) {
    const credentialsPath = path.resolve(__dirname, "..", "..", `org-roster-credentials-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
    const lines = [
      "UMA org roster import - private initial credentials",
      `Generated: ${new Date().toISOString()}`,
      `Database: ${db.databaseName}`,
      "",
      "Each person logs in with their DNI, not email. Distribute each line only",
      "to that person, over a secure channel, then delete this file. Every account",
      "has passwordResetRequired set, but changing the password is not yet",
      "enforced by the app on first login — treat these as sensitive until that",
      "is built, and rotate any password you suspect was seen by the wrong person.",
      ""
    ];
    for (const credential of issuedCredentials) {
      lines.push(`${credential.name} | DNI: ${credential.dni}`);
      lines.push(`Password: ${credential.password}`);
      lines.push("");
    }
    await fs.writeFile(credentialsPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    report.credentialsFile = credentialsPath;
    report.credentialsIssued = issuedCredentials.length;
  }

  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  const expected = process.argv.find((arg) => arg.startsWith("--database="))?.slice("--database=".length);
  const rosterPath = process.argv.find((arg) => arg.startsWith("--roster="))?.slice("--roster=".length);
  try {
    if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI explicitly; no default database is used.");
    if (!rosterPath) throw new Error("Pass --roster=<path.json>.");
    if (apply && (!expected || !process.argv.includes("--maintenance-confirmed"))) throw new Error("Apply requires --database=<exact-name> --maintenance-confirmed. Stop API/workers and take a verified backup first.");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    if (expected && mongoose.connection.name !== expected) throw new Error("Connected database does not match --database.");
    const report = await migrateOrgRoster(mongoose.connection.db, { apply, rosterPath });
    console.log(JSON.stringify(report, null, 2));
    if (report.manualReview.length || report.conflicts.length) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
