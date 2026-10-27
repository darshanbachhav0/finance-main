/**
 * UMA staff bulk assignment - generated from employee and Treasury sheets.
 *
 * Run from backend folder. Does NOT create accounts, change role/access permissions,
 * clear passwords, change cost centers, or update existing job categories.
 *
 * Dry run (no writes):
 * node scripts/applyUmaStaffAssignments.js --file=../data/uma-employee-assignments.json --dry-run
 * Apply:
 * node scripts/applyUmaStaffAssignments.js --file=../data/uma-employee-assignments.json --apply --database=EXACT_DB_NAME --maintenance-confirmed --backup-confirmed --reviewed --replace-supervisors --replace-titles
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const flag = (s) => args.includes(s);
const arg = (k) => args.find((v) => v.startsWith(k + '='))?.slice(k.length + 1);
const mode = flag('--apply') ? 'APPLY' : flag('--validate-only') ? 'VALIDATE_ONLY' : 'DRY_RUN';
const sourceFile = path.resolve(arg('--file') || '../data/uma-employee-assignments.json');
const dbNameRequired = arg('--database');
const replaceSupervisors = flag('--replace-supervisors');
const replaceTitles = flag('--replace-titles');
const skipTemporaryCategory = flag('--preserve-blank-categories');
const expectedFields = ['dni', 'name', 'jobTitle', 'supervisorDni'];
const dniOk = (v) => /^\d{8}$/.test(String(v || ''));
const asDni = (v) => v == null ? '' : String(v).trim().padStart(8, '0');
const id = (v) => v == null ? '' : String(v);
const sameStr = (a,b) => String(a ?? '').trim() === String(b ?? '').trim();

async function saveReport(report) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.resolve('data/reports', 'uma-employee-assignment-' + timestamp + '.json');
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return dest;
}

function validate(data) {
  if (!data || !Array.isArray(data.employees) || data.employees.length !== 266) {
    throw new Error('Expected the complete reviewed source of 266 employees.');
  }
  const seen = new Set();
  const roster = new Map();
  for (const row of data.employees) {
    for (const k of expectedFields) if (!(k in row)) throw new Error(`Missing field ${k} in source`);
    if (!dniOk(row.dni) || seen.has(row.dni)) throw new Error('Invalid/duplicate source DNI');
    if (!String(row.name).trim() || !String(row.jobTitle).trim()) throw new Error(`Missing name/title: ${row.dni}`);
    if (row.supervisorDni && (!dniOk(row.supervisorDni) || row.supervisorDni === row.dni)) {
      throw new Error(`Invalid/self supervisor: ${row.dni}`);
    }
    if (row.temporaryJobCategory !== 1 || row.categoryEvidence !== 'TEMPORARY_RESTRICTED_NOT_OFFICIAL_HR') {
      throw new Error(`Invalid temporary category: ${row.dni}`);
    }
    seen.add(row.dni); roster.set(row.dni, row);
  }
  const links = new Map();
  for (const row of data.employees) {
    if (row.supervisorDni && !seen.has(row.supervisorDni)) throw new Error(`Supervisor missing from input: ${row.dni}`);
    if (row.supervisorDni) links.set(row.dni, row.supervisorDni);
  }
  for (const start of links.keys()) {
    const pathSet = new Set(); let node = start; let steps = 0;
    while (links.has(node)) {
      if (pathSet.has(node)) throw new Error(`Roster manager-chain cycle at ${node}`);
      pathSet.add(node); node = links.get(node); steps++;
      if (steps > 12) throw new Error(`Roster supervisor chain exceeds 12 levels for ${start}`);
    }
  }
  return { roster, links };
}

function cyclesInDb(graph) {
  for (const [start] of graph) {
    let cursor = start; const visited = new Set();
    for (let depth = 0; graph.has(cursor) && graph.get(cursor); depth++) {
      if (visited.has(cursor)) return `Manager cycle at user object ${cursor}`;
      if (depth >= 12) return `Manager chain exceeds 12 levels for user object ${start}`;
      visited.add(cursor); cursor = graph.get(cursor);
    }
  }
  return null;
}

async function main() {
  if (flag('--apply') && (flag('--dry-run') || flag('--validate-only'))) throw new Error('Choose only one mode.');
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const { links } = validate(source);
  const report = {
    mode, sourceFile, createdAt: new Date().toISOString(), sourceRows: source.employees.length,
    sourceSupervisorLinks: links.size,
    categoryPolicy: skipTemporaryCategory ? 'PRESERVE_UNSET' : 'FILL_UNSET_WITH_RESTRICTED_TEMPORARY_1',
    warning: 'Numeric HR categories are not in either source. Category 1 is a restricted temporary placeholder; categories 3/5/6 are never guessed.',
    planned: [], skipped: [], conflicts: [], updated: []
  };
  if (mode === 'VALIDATE_ONLY') {
    console.log(JSON.stringify({ mode, sourceRows: report.sourceRows, supervisorLinks: links.size,
      corrections: source.employees.filter(r => r.identityEvidence !== 'EMPLOYEE_SHEET' || r.supervisorEvidence !== 'EXACT_NAME_EMPLOYEE_SHEET').length,
      report: await saveReport(report) }, null, 2));
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not found. Configure backend/.env first.');
  if (mode === 'APPLY' && (!dbNameRequired || !flag('--maintenance-confirmed') || !flag('--backup-confirmed') || !flag('--reviewed'))) {
    throw new Error('Apply requires --database=EXACT_NAME --maintenance-confirmed --backup-confirmed --reviewed');
  }
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  try {
    const db = mongoose.connection.db;
    if (dbNameRequired && db.databaseName !== dbNameRequired) throw new Error(`Database mismatch. Connected to ${db.databaseName}, expected ${dbNameRequired}`);
    report.database = db.databaseName;
    const users = db.collection('users');
    const dbUsers = await users.find({}, { projection: { _id: 1, dni: 1, name: 1, active: 1, role: 1, jefe: 1, jobTitle: 1, jobCategory: 1 } }).toArray();
    const byDni = new Map(dbUsers.filter(u => dniOk(asDni(u.dni))).map(u => [asDni(u.dni), u]));
    const graph = new Map(dbUsers.map(u => [id(u._id), id(u.jefe)]));
    const planned = [];
    for (const row of source.employees) {
      const user = byDni.get(row.dni);
      if (!user) { report.skipped.push({ dni: row.dni, reason: 'ACCOUNT_NOT_FOUND; no account created' }); continue; }
      if (user.active === false || ['SuperAdmin', 'ManagementViewer', 'Auditor'].includes(user.role)) {
        report.skipped.push({ dni: row.dni, reason: `INACTIVE_OR_PROTECTED_ROLE:${user.role}` }); continue;
      }
      const updates = {}; const before = {};
      if (!sameStr(user.jobTitle, row.jobTitle)) {
        if (user.jobTitle && !replaceTitles) report.skipped.push({ dni: row.dni, reason: 'DIFFERENT_EXISTING_JOB_TITLE; use --replace-titles' });
        else { updates.jobTitle = row.jobTitle; before.jobTitle = user.jobTitle ?? null; }
      }
      // Never fabricate HR categories 3/5/6. Keep existing categories, set 1 ONLY if empty.
      if (!skipTemporaryCategory && (user.jobCategory === undefined || user.jobCategory === null)) {
        updates.jobCategory = 1; before.jobCategory = user.jobCategory ?? null;
      }
      const boss = row.supervisorDni ? byDni.get(row.supervisorDni) : null;
      if (row.supervisorDni && (!boss || boss.active === false || ['SuperAdmin', 'Auditor', 'ManagementViewer'].includes(boss.role))) {
        report.skipped.push({ dni: row.dni, reason: `SUPERVISOR_NOT_ACTIVE_OR_NOT_IN_DB:${row.supervisorDni}` });
      } else {
        const desired = boss?._id || null;
        if (id(user.jefe) !== id(desired)) {
          if (user.jefe && !replaceSupervisors) report.skipped.push({ dni: row.dni, reason: 'EXISTING_DIFFERENT_SUPERVISOR; use --replace-supervisors' });
          else { updates.jefe = desired; before.jefe = id(user.jefe) || null; graph.set(id(user._id), id(desired)); }
        }
      }
      if (Object.keys(updates).length) {
        const item = { _id: user._id, dni: row.dni, name: row.name, before, update: updates, supervisorEvidence: row.supervisorEvidence, identityEvidence: row.identityEvidence };
        planned.push(item);
        report.planned.push({ dni: row.dni, name: row.name, before,
          after: Object.fromEntries(Object.entries(updates).map(([k,v]) => [k, k === 'jefe' ? (row.supervisorDni || null) : v])),
          supervisorEvidence: row.supervisorEvidence, identityEvidence: row.identityEvidence });
      }
    }
    const cycle = cyclesInDb(graph);
    if (cycle) report.conflicts.push({ type: 'SUPERVISOR_GRAPH', reason: cycle });
    const dest = await saveReport(report);
    console.log(JSON.stringify({ mode, database: db.databaseName, sourceRows: source.employees.length,
      dbAccountsMatched: source.employees.filter(r => byDni.has(r.dni)).length,
      plannedUserUpdates: planned.length, skippedItems: report.skipped.length,
      conflicts: report.conflicts.length, reportPath: dest }, null, 2));
    if (report.conflicts.length) throw new Error('Manager-chain conflict: report generated, no changes applied.');
    if (mode !== 'APPLY') return;
    const audit = db.collection('auditlogs');
    let updated = 0;
    for (const item of planned) {
      // Protect against accidentally changing accounts that were modified since planning.
      const result = await users.updateOne({ _id: item._id }, { $set: { ...item.update, updatedAt: new Date() } });
      if (result.modifiedCount) {
        updated++;
        await audit.insertOne({ module: 'USER_ADMIN', entity: item.name, entityType: 'User', entityId: item._id,
          action: 'UMA_STAFF_ROSTER_IMPORTED', actorName: 'UMA roster bulk import (operator-reviewed)',
          oldValues: item.before,
          newValues: report.planned.find(p => p.dni === item.dni)?.after || {},
          comments: `Imported using two UMA worksheets. Numeric category 1 only if previously empty; original HR category unknown. Supervisor evidence: ${item.supervisorEvidence}.`,
          createdAt: new Date() });
      }
    }
    console.log(JSON.stringify({ mode, updatedUsers: updated, database: db.databaseName, reportPath: dest,
      note: 'Reload Admin > User Administration to inspect. Existing pending approvals must be reviewed separately.' }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(err => { console.error('UMA staff import: ' + err.message); process.exitCode = 1; });
