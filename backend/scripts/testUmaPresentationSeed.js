// Tests the additive seed on a disposable copy of local master data, not the live database.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source=new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27018/uma_finance_triple_track_fresh');
const target=new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017');
const name=`erp_presentation_test_${process.pid}_${Date.now()}`;
const cwd=fileURLToPath(new URL('../../',import.meta.url));
try {
 await source.connect(); await target.connect();
 for(const collection of ['users','costcenters','expensetypes','approvalrules','documentrules','accountingmappings','accountingperiods','financeconfigurations']) {
  const docs=await source.db().collection(collection).find({}).toArray();
  if(docs.length)await target.db(name).collection(collection).insertMany(docs);
 }
 const env={...process.env,NODE_ENV:'test',MONGODB_URI:`mongodb://127.0.0.1:27017/${name}`};
 function run(script,args=[]) {const result=spawnSync(process.execPath,[`backend/scripts/${script}`,...args],{cwd,env,encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;}
 run('seedUmaPresentation.js',[`--database=${name}`]);
 assert.equal(await target.db(name).collection('financialrequests').countDocuments(),0,'Dry-run must not insert requests.');
 run('seedUmaPresentation.js',[`--database=${name}`,'--apply']);
 const before=await target.db(name).collection('financialrequests').countDocuments();
 const repeated=run('seedUmaPresentation.js',[`--database=${name}`,'--apply']);
 assert.match(repeated,/"alreadyApplied": true/);
 assert.equal(await target.db(name).collection('financialrequests').countDocuments(),before);
 console.log(run('verifyUmaPresentation.js'));
 console.log('PASS: dry-run, additive preservation, repeat import, chart APIs, financial evidence and fiscal-export exclusion.');
} finally {
 if(name.startsWith('erp_presentation_test_'))await target.db(name).dropDatabase();
 await source.close();await target.close();
}
