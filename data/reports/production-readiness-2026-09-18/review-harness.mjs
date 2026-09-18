// Review-only harness. Source database access uses raw read operations only.
// All migration processes are dry-run and target disposable local copies.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import '../../../backend/src/models/Supplier.js';
import { buildSirePreview, exportSireFile } from '../../../backend/src/services/sireService.js';
const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../../..');
const prefix = `erp_readiness_review_${process.pid}_${Date.now()}`;
const local = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 });
const source = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27018', { serverSelectionTimeoutMS: 5000 });
const summary = { generatedAt: new Date().toISOString(), sourceDatabase: 'uma_finance_triple_track_fresh', sourceAccess: 'raw read only', migrations: [], findings: {} };
const sourceDocs = new Map();
const digest = docs => crypto.createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(docs)).digest('hex');
try {
 await local.connect();
 try {
  await source.connect();
  const db = source.db(summary.sourceDatabase);
  const hello = await db.admin().command({ hello: 1 });
  summary.sourceReplicaSet = hello.setName || null;
  summary.sourceCounts = {};
  summary.sourceIndexes = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
   if (name.startsWith('system.')) continue;
   const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
   sourceDocs.set(name, docs); summary.sourceCounts[name] = docs.length;
   summary.sourceIndexes[name] = await db.collection(name).indexes();
  }
  summary.activeDemoCostCenters = (sourceDocs.get('costcenters') || []).filter(x => x.active !== false && (/^CC-/i.test(x.code || '') || /demo/i.test(x.name || ''))).map(x => ({ code: x.code, name: x.name }));
  summary.bankConfigurations = (sourceDocs.get('bankformatconfigurations') || []).map(x => ({ bank: x.bank, currency: x.currency, active: x.active, mode: x.mode, confirmed: x.bbva?.confirmed === true }));
  summary.appliedMigrationKeys = (sourceDocs.get('migrationruns') || []).map(x => x.key || x.migration || x.name || String(x._id));
  const loginSource = await fs.readFile(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  const demoPassword = loginSource.match(/password: "([^"]+)"/)?.[1];
  summary.activeAccountsUsingPublishedDemoPassword = 0;
  if (demoPassword) for (const user of sourceDocs.get('users') || []) {
   if (user.active !== false && user.passwordHash && await bcrypt.compare(demoPassword, user.passwordHash)) summary.activeAccountsUsingPublishedDemoPassword++;
  }
 } catch (e) { summary.sourceUnavailable = e.message; }
 const staging = local.db(prefix);
 for (const [name, docs] of sourceDocs) if (docs.length) await staging.collection(name).insertMany(docs);
 summary.migrationData = sourceDocs.size ? 'copy of configured local launcher database; not a production-certified snapshot' : 'empty isolated database; source unavailable';
 const env = { ...process.env, MONGODB_URI: `mongodb://127.0.0.1:27017/${prefix}`, NODE_ENV: 'test' };
 const scripts = ['migrateCanonicalWorkflow.js', 'migrateOfficialUmaFormatsFoundation.js', 'migrateTripleTrackWorkflow.js', 'migrateWorkflowStatusesV2.js', 'migrateDocumentPhases.js', 'importUmaCostCenters.js'];
 for (const script of scripts) {
  const args = [`scripts/${script}`];
  if (script === 'importUmaCostCenters.js') args.push(`--report=${path.join(out, 'ceco-dry-run.json')}`);
  for (let run = 1; run <= 2; run++) {
   const result = spawnSync(process.execPath, args, { cwd: path.join(root, 'backend'), env, encoding: 'utf8', timeout: 120000 });
   await fs.writeFile(path.join(out, `${script}.run-${run}.log`), (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : ''));
   summary.migrations.push({ script, run, mode: 'DRY_RUN', exitCode: result.status, error: result.error?.message });
  }
 }
 if (sourceDocs.size) {
  summary.sourceDocumentsUnchanged = true;
  for (const [name, docs] of sourceDocs) {
   const after = await source.db(summary.sourceDatabase).collection(name).find({}).sort({ _id: 1 }).toArray();
   if (digest(after) !== digest(docs)) summary.sourceDocumentsUnchanged = false;
  }
 }
 await mongoose.connect(`mongodb://127.0.0.1:27017/${prefix}_sire`);
 const db = mongoose.connection.db, id = () => new mongoose.Types.ObjectId();
 const supplier = id(), request = id(), payable = id(), voucher = id(), actor = id();
 await db.collection('suppliers').insertOne({ _id: supplier, rucDni: '20600000001', legalName: 'TEST ONLY Supplier', active: true });
 await db.collection('financialrequests').insertOne({ _id: request, requestNumber: 'TEST-ONLY-SIRE', accountingPeriod: '2026-09', fiscalData: { accountingDate: new Date('2026-09-10'), fiscalPeriod: '2026-09' }, supplier, status: 'CONTABILIZADO' });
 await db.collection('accountspayables').insertOne({ _id: payable, request, supplier, sunatVoucher: voucher, originalAmount: 118, currency: 'PEN', status: 'OPEN', exchangeRate: 1 });
 await db.collection('sunatvouchers').insertOne({ _id: voucher, request, accountsPayable: payable, supplier, rucIssuer: '20600000001', voucherType: 'FACTURA', series: 'F001', number: '000001', issueDate: new Date('2026-09-09'), currency: 'PEN', netAmount: 100, igvAmount: 18, xmlAmount: 118, validationStatus: 'VALID', validationEvidence: { valid: true, fiscal: { valid: true, voucherVerified: true, source: 'TEST' } } });
 summary.findings.sireWithoutJournalEligible = (await buildSirePreview('2026-09')).rows.length;
 await db.collection('accountspayables').updateOne({ _id: payable }, { $set: { status: 'CANCELLED' } });
 summary.findings.sireCancelledPayableEligible = (await buildSirePreview('2026-09')).rows.length;
 await db.collection('accountspayables').updateOne({ _id: payable }, { $set: { status: 'OPEN', originalAmount: 999, currency: 'USD', exchangeRate: 3.8 } });
 summary.findings.sireMismatchedAmountCurrencyEligible = (await buildSirePreview('2026-09')).rows.length;
 await db.collection('accountspayables').updateOne({ _id: payable }, { $set: { originalAmount: 118, currency: 'PEN', exchangeRate: 1 } });
 await db.collection('financialrequests').insertOne({ _id: id(), requestNumber: 'TEST-ONLY-LEGACY-NO-CXP', accountingPeriod: '2026-08', fiscalData: { accountingDate: new Date('2026-08-10'), fiscalPeriod: '2026-08' }, supplier, status: 'PAGADO_CERRADO' });
 summary.findings.sireLegacyWithoutPayableVisible = (await buildSirePreview('2026-08')).validations.length;
 const journal = id();
 await db.collection('journalentries').insertOne({ _id: journal, request, accountsPayable: payable, entryType: 'PROVISION', status: 'POSTED', period: '2026-09', postedAt: new Date('2026-09-10') });
 await db.collection('accountspayables').updateOne({ _id: payable }, { $set: { provisionJournal: journal } });
 const exported = await exportSireFile({ period: '2026-09', user: { _id: actor } });
 await fs.writeFile(path.join(out, 'TEST-ONLY-SIRE.csv'), exported.content);
 summary.sireTestExport = { rows: exported.history.rowCount, schemaVersion: exported.history.metadata.schemaVersion, directSubmission: false };
 await fs.unlink(path.join(root, 'backend/generated/reports', exported.history.fileName));
} catch (error) { summary.harnessError = error.stack; process.exitCode = 1; }
finally {
 await mongoose.disconnect();
 for (const name of [prefix, `${prefix}_sire`]) {
  if (!name.startsWith('erp_readiness_review_')) throw new Error('Unsafe cleanup');
  await local.db(name).dropDatabase().catch(() => {});
 }
 await local.close(); await source.close();
 await fs.writeFile(path.join(out, 'review-evidence.json'), JSON.stringify(summary, null, 2));
 console.log(JSON.stringify(summary, null, 2));
}
