// Manual/local demo utility, not part of the production path.
// Read-only verification of the presentation data and chart API contracts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../../../src/app.js';
import FinancialRequest from '../../../src/models/FinancialRequest.js';
import User from '../../../src/models/User.js';
import JournalEntry from '../../../src/models/JournalEntry.js';
import BudgetAllocation from '../../../src/models/BudgetAllocation.js';
import { getFinancialProgress } from '../../../src/services/financialProgressService.js';
import { buildSirePreview } from '../../../src/services/sireService.js';

if(!process.env.MONGODB_URI) throw new Error('Explicit MONGODB_URI required.');
await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
const summary={database:mongoose.connection.name,passed:false,roles:[],charts:{}};
try {
 const requests=await FinancialRequest.find({developmentScenarioKey:/^uma-finance-presentation-v1-/});
 assert.equal(requests.length,54);
 let partial=0;
 for(const request of requests) {
  const progress=await getFinancialProgress(request);
  if(['CONTABILIZADO','PROGRAMADO','TXT_GENERADO','PAGADO','CONCILIADO','CERRADO'].includes(request.status)) assert.equal(progress.status,request.status==='CERRADO'?'CONCILIADO':request.status,request.requestNumber);
  if(progress.partialPayment) partial++;
 }
 assert.equal(partial,1);
 for(const entry of await JournalEntry.find({sourceTransaction:/^DEMO-uma-finance-presentation/}).lean()) assert.equal(entry.totalDebit,entry.totalCredit);
 for(const plan of await BudgetAllocation.find({project:/^DEMO -/}).lean()) {
  assert.ok(plan.assignedAmount>=plan.committedAmount+plan.executedAmount);
  for(const field of ['committedAmount','executedAmount','paidAmount']) assert.ok(Math.abs(plan[field]-plan.months.reduce((sum,x)=>sum+x[field],0))<0.01,field);
 }
 const users=await User.find({active:true});
 for(const role of ['Admin','Management','Budget','Accounting','Treasury','Solicitor','Approver']) {
  const user=users.find(x=>x.role===role); assert.ok(user,role);
  const token=jwt.sign({id:user._id},process.env.JWT_SECRET||'dev_secret_change_me');
  const read=async route=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{headers:{Authorization:`Bearer ${token}`}});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.data||body;};
  await read('/dashboard/summary'); await read('/requests?limit=100');
  summary.roles.push(role);
  if(role==='Management') {
   const report=await read('/reports/management');
   for(const field of ['byMonth','byArea','byType','payable','paymentComparison','approvalSla','byCostCenter']) {assert.ok(report[field]?.length,field);summary.charts[field]=report[field].length;}
   assert.ok(report.byMonth.length>=6);
  }
 }
 for(const period of new Set(requests.map(x=>x.accountingPeriod))) {
  const preview=await buildSirePreview(period);
  assert.equal(preview.rows.filter(x=>x.series==='DEMO').length,0,'Simulated vouchers must not be fiscal-export eligible.');
 }
 summary.passed=true; summary.requests=requests.length; summary.partialPaymentScenarios=partial;
 console.log(JSON.stringify(summary,null,2));
 await fs.mkdir(new URL('../../../../data/reports/uma-presentation/',import.meta.url),{recursive:true});
 await fs.writeFile(new URL('../../../../data/reports/uma-presentation/verification.json',import.meta.url),JSON.stringify(summary,null,2));
} finally {await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();}
