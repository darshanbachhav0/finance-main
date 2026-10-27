/**
 * Assign the primary cost center (CeCo) of UMA employees from the vetted 266-row
 * roster, cross-referenced with Centro de Costo - Tesoreria.xlsx.
 *
 * Run from backend/ directory, after installing project dependencies.
 * - Validation: node scripts/assignUmaEmployeeCostCenters.js --validate-only
 * - Preview:    node scripts/assignUmaEmployeeCostCenters.js --dry-run
 * - Apply:      node scripts/assignUmaEmployeeCostCenters.js --apply --database=EXACT_DB_NAME \
 *               --backup-confirmed --maintenance-confirmed --reviewed --replace-existing
 *
 * Does NOT touch existing budgets, other cost centers, permissions, users' job
 * categories, managers, password, roles, prior financial records, or deactivation.
 * Any employee with mismatching CeCo in the two sheets is held for review.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const cli = process.argv.slice(2);
const has = (key) => cli.includes(key);
const opt = (key) => cli.find((v) => v.startsWith(`${key}=`))?.slice(key.length + 1);
const APPLY = has('--apply');
const VALIDATE = has('--validate-only');
const mode = VALIDATE ? 'VALIDATE_ONLY' : APPLY ? 'APPLY' : 'DRY_RUN';
const file = path.resolve(opt('--file') || '../data/uma-cost-center-assignments.json');
const expectedDatabase = opt('--database') || '';
const now = () => new Date();
const id = (v) => String(v?._id ?? v ?? '');
const dbDni = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{1,8}$/.test(s) ? s.padStart(8, '0') : '';
};
const maybeDbId = (v) => v == null ? null : id(v);

async function reportToDisk(report) {
  const outputDir = path.resolve('data/reports');
  await fs.mkdir(outputDir, { recursive: true });
  const filename = `uma-cost-center-assignment-${mode.toLowerCase()}-${now().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(outputDir, filename);
  await fs.writeFile(filepath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return filepath;
}

function validateSource(source) {
  if (source?.version !== 1 || source?.primarySource !== 'data em.xlsx' || source?.conflictPolicy !== 'SKIP_DISPUTED_DNI') {
    throw Error('Unexpected assignment source/version/policy. Use the reviewed package.');
  }
  if (!Array.isArray(source.rows) || source.rows.length !== 266 || !Array.isArray(source.centers) || source.centers.length !== 43) {
    throw Error('Incomplete roster: expected 266 employees and 43 cost center codes.');
  }
  const people = new Set();
  const codes = new Set();
  for (const row of source.rows) {
    if (!/^\d{8}$/.test(String(row.dni)) || people.has(row.dni) || !/^\d{5}$/.test(String(row.code))) {
      throw Error(`Invalid or repeated employee DNI/cost center on source row ${row.sourceRow}`);
    }
    if (!String(row.name || '').trim() || !String(row.area || '').trim()) {
      throw Error(`Missing employee name or area at row ${row.sourceRow}`);
    }
    if (!['MATCHED_TREASURY', 'EMPLOYEE_ROSTER_ONLY', 'CONFLICT_CODE'].includes(row.status)) {
      throw Error(`Invalid evidence type for source row ${row.sourceRow}`);
    }
    if (row.status === 'CONFLICT_CODE' && (!row.treasuryCode || row.treasuryCode === row.code)) {
      throw Error(`Missing Treasury discrepancy for employee row ${row.sourceRow}`);
    }
    if (row.status === 'MATCHED_TREASURY' && row.code !== row.treasuryCode) {
      throw Error(`False Treasury agreement for employee row ${row.sourceRow}`);
    }
    people.add(row.dni); codes.add(row.code);
  }
  const centerCodes = new Set();
  for (const center of source.centers) {
    if (!codes.has(center.code) || centerCodes.has(center.code) || !center.name || !center.area) {
      throw Error(`Invalid or duplicate cost center definition for ${center.code}`);
    }
    centerCodes.add(center.code);
  }
  if (centerCodes.size !== codes.size) throw Error('Cost center definitions do not match employees.');
  return {
    employeesInSource: source.rows.length,
    distinctCentersInSource: source.centers.length,
    crossChecked: source.rows.filter((r) => r.status === 'MATCHED_TREASURY').length,
    rosterOnly: source.rows.filter((r) => r.status === 'EMPLOYEE_ROSTER_ONLY').length,
    disputed: source.rows.filter((r) => r.status === 'CONFLICT_CODE').map((r) => ({
      dni: r.dni, sourceRow: r.sourceRow, employeeSheet: r.code, treasurySheet: r.treasuryCode
    })),
    centersWithDifferentMetadata: source.centers.filter((c) => c.metadataVariants.length > 1).map((c) => ({
      code: c.code, variants: c.metadataVariants
    }))
  };
}

function chooseAccount(users, dni) {
  const matches = new Map();
  for (const u of users) {
    if (dbDni(u.dni) === dni) matches.set(id(u._id), { user: u, matchedBy: 'DNI' });
    else if (dbDni(u.employeeCode) === dni && !matches.has(id(u._id))) {
      matches.set(id(u._id), { user: u, matchedBy: 'EMPLOYEE_CODE' });
    }
  }
  return [...matches.values()];
}

function previewAssignments(source, users, centers, report) {
  const existingByCode = new Map();
  for (const center of centers) {
    if (existingByCode.has(center.code)) throw Error(`Duplicate cost center in MongoDB: ${center.code}`);
    existingByCode.set(center.code, center);
  }
  const definitions = new Map(source.centers.map((c) => [c.code, c]));
  const updates = [];
  for (const row of source.rows) {
    if (row.status === 'CONFLICT_CODE') {
      report.skipped.push({ dni: row.dni, code: row.code, reason: `DISPUTED_SOURCES: Employee roster ${row.code}, Treasury ${row.treasuryCode}` });
      continue;
    }
    const candidates = chooseAccount(users, row.dni);
    if (!candidates.length) { report.skipped.push({ dni: row.dni, code: row.code, reason: 'ACCOUNT_NOT_FOUND_BY_DNI' }); continue; }
    if (candidates.length > 1) { report.skipped.push({ dni: row.dni, code: row.code, reason: 'MULTIPLE_ACCOUNTS_SAME_DNI' }); continue; }
    const { user, matchedBy } = candidates[0];
    if (user.active === false || ['SuperAdmin', 'Auditor', 'ManagementViewer'].includes(user.role)) {
      report.skipped.push({ dni: row.dni, code: row.code, reason: `INACTIVE_OR_PROTECTED:${user.role || 'UNKNOWN'}` });
      continue;
    }
    const target = existingByCode.get(row.code) || definitions.get(row.code);
    if (!target) { report.skipped.push({ dni: row.dni, code: row.code, reason: 'COST_CENTER_DEFINITION_MISSING' }); continue; }
    if (target.active === false) {
      report.skipped.push({ dni: row.dni, code: row.code, reason: 'COST_CENTER_INACTIVE_REQUIRES_ADMIN_REVIEW' });
      continue;
    }
    const beforeCenter = centers.find(c => id(c._id) === maybeDbId(user.costCenter));
    const previousCode = beforeCenter?.code || (user.costCenter ? `UNKNOWN:${id(user.costCenter)}` : null);
    const unchanged = previousCode === row.code;
    if (unchanged) { report.unchanged.push({ dni: row.dni, code: row.code }); continue; }
    if (user.costCenter && !has('--replace-existing')) {
      report.skipped.push({ dni: row.dni, code: row.code, existingCode: previousCode, reason: 'EXISTING_PRIMARY_CENTER_DIFFERS; review and use --replace-existing' });
      continue;
    }
    const u = {
      userId: user._id, userName: user.name, dni: row.dni, code: row.code,
      sourceRow: row.sourceRow, matchedBy, oldCostCenterId: user.costCenter ?? null,
      oldCode: previousCode, targetExists: Boolean(existingByCode.get(row.code))
    };
    updates.push(u);
    report.updatesPlanned.push({ dni: row.dni, name: row.name, from: previousCode, to: row.code, matchedBy, sourceRow: row.sourceRow });
  }
  report.centersMissing = source.centers.filter((c) => !existingByCode.has(c.code)).map((c) => ({ code: c.code, name: c.name }));
  report.centerCodesInDatabase = centers.length;
  return { updates, definitions };
}

async function main() {
  if ([VALIDATE, APPLY, has('--dry-run')].filter(Boolean).length > 1) throw Error('Choose only one: --validate-only, --dry-run or --apply');
  const source = JSON.parse(await fs.readFile(file, 'utf8'));
  const checked = validateSource(source);
  const report = { mode, timestamp: now().toISOString(), source: file, checked,
    database: null, centersMissing: [], updatesPlanned: [], unchanged: [], skipped: [], changesApplied: [], errors: [] };
  if (VALIDATE) {
    const reportPath = await reportToDisk(report);
    console.log(JSON.stringify({ mode, ...checked, reportPath }, null, 2));
    return;
  }
  if (APPLY && (!expectedDatabase || !has('--backup-confirmed') || !has('--maintenance-confirmed') || !has('--reviewed') || !has('--replace-existing'))) {
    throw Error('Apply requires --database=EXACT_DB_NAME --backup-confirmed --maintenance-confirmed --reviewed --replace-existing');
  }
  await import('dotenv/config');
  if (!process.env.MONGODB_URI) throw Error('MONGODB_URI is missing in backend/.env; database not accessed.');
  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  try {
    const db = mongoose.connection.db;
    report.database = db.databaseName;
    if (expectedDatabase && db.databaseName !== expectedDatabase) {
      throw Error(`Database mismatch: expected ${expectedDatabase}, connected to ${db.databaseName}`);
    }
    const [users, centers] = await Promise.all([
      db.collection('users').find({}, { projection: { _id: 1, dni: 1, employeeCode: 1, name: 1, active: 1, role: 1, costCenter: 1 } }).toArray(),
      db.collection('costcenters').find({}, { projection: { _id: 1, code: 1, name: 1, active: 1 } }).toArray()
    ]);
    const { updates, definitions } = previewAssignments(source, users, centers, report);
    const reportPath = await reportToDisk(report);
    console.log(JSON.stringify({ mode, database: report.database, employeeRows: checked.employeesInSource,
      matchedForChange: updates.length, alreadyCorrect: report.unchanged.length,
      skipped: report.skipped.length, disputed: checked.disputed.length,
      missingCentersToCreate: report.centersMissing.length, reportPath }, null, 2));
    if (!APPLY) return;
    const costcenters = db.collection('costcenters');
    const usersCollection = db.collection('users');
    const auditlogs = db.collection('auditlogs');
    const importedAt = now();
    for (const item of report.centersMissing) {
      const center = definitions.get(item.code);
      const created = {
        code: center.code, name: center.name, area: center.area,
        organizationalUnit: center.organizationalUnit, organizationalUnitCode: '',
        sourceRows: center.sourceRows, active: true,
        annualBudget: 0, committedAmount: 0, executedAmount: 0, paidAmount: 0,
        budgetMode: 'TRANSITIONAL', availableAmount: 0,
        importProvenance: { source: 'data em.xlsx', sourceSheet: 'Consolidado', status: 'ACTIVE', importedAt },
        createdAt: importedAt, updatedAt: importedAt
      };
      await costcenters.updateOne({ code: center.code }, { $setOnInsert: created }, { upsert: true });
    }
    const allRequiredCenters = await costcenters.find({ code: { $in: updates.map(u => u.code) } }, { projection: { _id: 1, code: 1, active: 1 } }).toArray();
    const targets = new Map(allRequiredCenters.filter(c => c.active !== false).map(c => [c.code, c._id]));
    let modified = 0;
    for (const item of updates) {
      const targetId = targets.get(item.code);
      if (!targetId) { report.errors.push({ dni: item.dni, reason: 'TARGET_CENTER_NOT_ACTIVE_AT_APPLY' }); continue; }
      const where = { _id: item.userId, costCenter: item.oldCostCenterId || null };
      const result = await usersCollection.updateOne(where, {
        $set: { costCenter: targetId, costCenterAssignment: {
          source: 'data em.xlsx', sourceRow: item.sourceRow, assignedAt: importedAt, matchedBy: item.matchedBy
        }, updatedAt: importedAt }
      });
      if (!result.modifiedCount) {
        report.errors.push({ dni: item.dni, reason: 'CONCURRENT_CHANGE_OR_USER_UNCHANGED' });
        continue;
      }
      modified++;
      report.changesApplied.push({ dni: item.dni, code: item.code });
      try {
        await auditlogs.insertOne({ module: 'USER_ADMIN', entity: item.userName, entityType: 'User', entityId: item.userId,
          action: 'UMA_PRIMARY_CECO_IMPORTED', actorName: 'UMA cost-center bulk import (operator reviewed)',
          oldValues: { primaryCeco: item.oldCode }, newValues: { primaryCeco: item.code },
          comments: 'Primary CECO assigned by DNI from data em.xlsx. No budgets, permissions, or alternate CECOs modified.',
          createdAt: importedAt });
      } catch (err) {
        report.errors.push({ dni: item.dni, reason: 'AUDIT_WRITE_FAILED', message: err.message });
      }
    }
    const finalReportPath = await reportToDisk(report);
    console.log(JSON.stringify({ mode, database: db.databaseName, usersUpdated: modified,
      usersAlreadyCorrect: report.unchanged.length, usersSkipped: report.skipped.length,
      newCostCenters: report.centersMissing.length,
      errors: report.errors.length, reportPath: finalReportPath }, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('UMA cost-center assignment:', error.message);
  process.exitCode = 1;
});
