/** Targeted cleanup of the two known UMA seed datasets. Dry-run by default.
 * Never resets a database, removes users, or changes immutable audit history.
 * Run with --apply only after inspecting the dry-run. Targeted EJSON backups
 * are required before deletion. Stop the application's writers while applying.
 */
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const demoScenario = /^(uma-finance-presentation-v1-\d+|UMA_0[123]_(BORRADOR_SALUD|PENDIENTE_DIRECTOR|PENDIENTE_VICERRECTOR))$/;
const demoCodes = ['CC-SAL-LAB-101','CC-FAR-LAB-201','CC-ING-TI-301','CC-ADM-FIN-401','CC-INV-POS-501','CC-REC-601'];
const childCollections = ['purchaseorders','accountspayables','journalentries','sunatvouchers','reconciliations','budgetcommitments','budgetexceptions','accountingentries','invoiceobservations','xmlvalidationattempts'];
const ids = rows => rows.map(row => row._id);
const key = value => String(value);
const digest = rows => createHash('sha256').update(EJSON.stringify(rows)).digest('hex');

export async function planDemoCleanup(db, session) {
  const read = (name, query = {}) => db.collection(name).find(query, {session}).sort({_id:1}).toArray();
  const plan = {};
  plan.financialrequests = await read('financialrequests', {developmentScenarioKey:demoScenario});
  const requestIds = ids(plan.financialrequests);
  for (const name of childCollections) plan[name] = await read(name, {request:{$in:requestIds}});
  const apIds = new Set(ids(plan.accountspayables).map(key));
  plan.paymentbatches = await read('paymentbatches', {'items.request':{$in:requestIds}});
  for (const batch of plan.paymentbatches) {
    if (batch.items.some(item => !requestIds.some(id => key(id) === key(item.request)) || !apIds.has(key(item.accountsPayable)))) {
      throw new Error('Mixed demo/real payment batch: manual review required.');
    }
  }
  plan.suppliers = await read('suppliers', {name:/^(DEMO - |.*\(Demo\)$)/});
  plan.supplierbankaccounts = await read('supplierbankaccounts', {supplier:{$in:ids(plan.suppliers)}});
  const centers = await read('costcenters', {code:{$in:demoCodes}});
  plan.budgetallocations = await read('budgetallocations', {$or:[{project:/^DEMO - /},{costCenter:{$in:ids(centers)}}]});
  plan.projects = await read('projects', {code:{$in:['PRJ-CAMPUS-DIGITAL-2026','PRJ-INV-BIOMED-2026']},costCenter:{$in:ids(centers)}});
  plan.exchangerates = await read('exchangerates', {source:'MANUAL',sourceLabel:/DEMO/});
  const demoUsers = await db.collection('users').find({email:/^demo\./},{session,projection:{_id:1}}).toArray();
  plan.employeereimbursementbankaccounts = await read('employeereimbursementbankaccounts', {verificationSource:'UMA_DEMO_MANUAL_REVIEW',user:{$in:ids(demoUsers)}});
  const entityIds = Object.values(plan).flatMap(ids);
  plan.notifications = await read('notifications', {$or:[{entityId:{$in:entityIds}},{entityType:'DEMO',eventKey:/^uma-finance-presentation-v1-/}]});
  plan.workdrafts = await read('workdrafts', {recordId:{$in:entityIds.map(key)}});

  // Refuse to strand genuine records or erase budgets used outside these seeds.
  const selected = new Set(Object.values(plan).flatMap(ids).map(key));
  const containsSelected = value => {
    if (value == null) return false;
    if (value instanceof mongoose.Types.ObjectId || typeof value === 'string') return selected.has(key(value));
    if (Array.isArray(value)) return value.some(containsSelected);
    if (typeof value === 'object') return Object.values(value).some(containsSelected);
    return false;
  };
  for (const name of ['financialrequests',...childCollections,'paymentbatches','suppliers','supplierbankaccounts','budgetallocations','massuploadbatches','generatedfiles','workdrafts']) {
    const retained = await db.collection(name).find({_id:{$nin:ids(plan[name] || [])}}, {session,projection:{payload:0}}).toArray();
    for (const row of retained) if (containsSelected(row)) throw new Error(`Retained ${name} record references demo data: manual review required.`);
  }
  const allocationIds = new Set(ids(plan.budgetallocations).map(key));
  if (plan.budgetcommitments.some(row => row.lines?.some(line => line.allocation && !allocationIds.has(key(line.allocation))))) {
    throw new Error('Demo commitments used a non-demo budget; manual balance review required.');
  }
  return plan;
}

export async function removeConfirmedDemoData(db, {apply=false, backupRoot='backend/backups'} = {}) {
  const plan = await planDemoCleanup(db);
  const counts = Object.fromEntries(Object.entries(plan).map(([name,rows]) => [name,rows.length]));
  if (!apply || !Object.values(counts).some(Boolean)) return {mode:apply?'APPLY':'DRY_RUN',counts};
  const backup = path.resolve(backupRoot, `confirmed-demo-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await fs.mkdir(backup,{recursive:true});
  const hashes = {};
  for (const [name,rows] of Object.entries(plan)) {
    const data = EJSON.stringify(rows);
    hashes[name] = digest(rows);
    await fs.writeFile(path.join(backup,`${name}.ejson`),data,{flag:'wx'});
    if (createHash('sha256').update(await fs.readFile(path.join(backup,`${name}.ejson`))).digest('hex') !== hashes[name]) throw new Error('Backup verification failed.');
  }
  await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify({database:db.databaseName,counts,hashes,createdAt:new Date(),note:'Only confirmed demo records; users and immutable audit history excluded.'},null,2));
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await planDemoCleanup(db,session);
      for (const [name,rows] of Object.entries(current)) if(digest(rows)!==hashes[name]) throw new Error('Records changed after backup; retry with a new dry-run.');
      for (const [name,rows] of Object.entries(current)) {
        if (!rows.length) continue;
        const result = await db.collection(name).deleteMany({_id:{$in:ids(rows)}},{session});
        if(result.deletedCount!==rows.length) throw new Error('Unexpected deletion count.');
      }
      await db.collection('auditlogs').insertOne({module:'SYSTEM',entity:'DemoDataset',entityType:'DemoDataset',entityId:'confirmed-demo-cleanup',action:'CONFIRMED_DEMO_DATA_REMOVED',message:'User-authorized cleanup of known demonstration datasets. Genuine data and prior audit records preserved.',newValues:{counts,backupManifest:path.basename(backup)},createdAt:new Date()},{session});
    });
  } finally {await session.endSession();}
  return {mode:'APPLY',counts,backup};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  dotenv.config({path:path.resolve('backend/.env'),quiet:true});
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured privately.');
  try {
    await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
    console.log(JSON.stringify(await removeConfirmedDemoData(mongoose.connection.db,{apply:process.argv.includes('--apply')}),null,2));
  } finally {await mongoose.disconnect();}
}
