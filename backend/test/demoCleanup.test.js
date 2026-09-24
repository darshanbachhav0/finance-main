import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {planDemoCleanup,removeConfirmedDemoData} from '../scripts/removeConfirmedDemoData.js';
// Intentionally isolated local database; never reads deployment environment files.
const database = `uma_demo_cleanup_test_${process.pid}`;
try {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`,{serverSelectionTimeoutMS:5000});
  const db = mongoose.connection.db;
  const demo=new mongoose.Types.ObjectId(), real=new mongoose.Types.ObjectId(), supplier=new mongoose.Types.ObjectId();
  await db.collection('financialrequests').insertMany([
    {_id:demo,developmentScenarioKey:'UMA_01_BORRADOR_SALUD',supplier},
    {_id:real,developmentScenarioKey:'',title:'Genuine request'}
  ]);
  await db.collection('suppliers').insertMany([{_id:supplier,name:'DEMO - Test'},{name:'Genuine supplier'}]);
  await db.collection('accountspayables').insertOne({request:demo});
  await db.collection('budgetallocations').insertOne({project:'Real budget',assignedAmount:20000});
  await db.collection('auditlogs').insertOne({action:'HISTORICAL'});
  await db.collection('users').insertOne({email:'demo.admin@uma.edu.pe',role:'Admin'});
  const preview = await removeConfirmedDemoData(db);
  assert.equal(preview.mode,'DRY_RUN');
  assert.equal(preview.counts.financialrequests,1);
  assert.equal(preview.counts.accountspayables,1);
  assert.equal(preview.counts.suppliers,1);
  assert.equal(preview.counts.budgetallocations,0);
  assert.equal(await db.collection('financialrequests').countDocuments(),2);
  assert.equal(await db.collection('auditlogs').countDocuments(),1);
  assert.equal(await db.collection('users').countDocuments(),1);
  assert.equal((await removeConfirmedDemoData(db)).counts.financialrequests,1);
  await db.collection('financialrequests').updateOne({_id:real},{$set:{supplier}});
  await assert.rejects(planDemoCleanup(db),/Retained financialrequests/);
  await db.collection('financialrequests').updateOne({_id:real},{$unset:{supplier:1}});
  await db.collection('paymentbatches').insertOne({items:[{request:demo},{request:real}]});
  await assert.rejects(planDemoCleanup(db),/Mixed demo\/real payment batch/);
  await db.collection('paymentbatches').deleteMany({});
  await db.collection('budgetcommitments').insertOne({request:demo,lines:[{allocation:new mongoose.Types.ObjectId()}]});
  await assert.rejects(planDemoCleanup(db),/non-demo budget/);
  console.log('PASS: demo selection, linked invoices, genuine budget preservation, dry-run safety, repeated preview, audit/user preservation, shared reference blocking, mixed batch blocking, shared budget blocking.');
} finally {
  if(mongoose.connection.name===database) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}
