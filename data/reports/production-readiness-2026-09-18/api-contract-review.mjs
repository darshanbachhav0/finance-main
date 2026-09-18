import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../../../backend/src/app.js';
import User from '../../../backend/src/models/User.js';
import FinancialRequest from '../../../backend/src/models/FinancialRequest.js';
const database = `erp_readiness_api_${process.pid}_${Date.now()}`;
await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const results = [];
try {
 const roles = [['Solicitor','Solicitor'],['Director','Approver','AREA_DIRECTOR'],['Vice Rector','Approver','VICE_RECTOR'],['Budget','Budget'],['Accounting','Accounting'],['Treasury','Treasury'],['Management','Management'],['Admin','Admin']];
 const users = [];
 for (const [label,role,approvalLevel] of roles) users.push({ label, user: await User.create({ name:label, email:`${users.length}@test.invalid`, passwordHash:'unused', role, approvalLevel, area:'Operations', active:true }) });
 const requestId = new mongoose.Types.ObjectId();
 const owner = users[0].user._id;
 await FinancialRequest.collection.insertOne({ _id:requestId, requestNumber:'TEST-ONLY-CONTRACT', requester:owner, solicitor:owner, requesterArea:'Operations', flowType:'C', requestType:'OPEX', currency:'PEN', totalAmount:118, totalPENEquivalent:118, status:'PENDIENTE_APROBACION', approvalStage:'AREA_DIRECTOR', approvalRouteSnapshot:[{sequence:1,required:true,status:'PENDING',role:'Approver',approvalLevel:'AREA_DIRECTOR'}], rendition:{status:'PENDING'}, lines:[], attachments:[], createdAt:new Date() });
 async function call(item, route, method='GET') {
  const token = jwt.sign({id:item.user._id},process.env.JWT_SECRET || 'dev_secret_change_me');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, ...(method==='POST'?{body:JSON.stringify({comments:'TEST ONLY'})}:{})});
  return {status:response.status,body:await response.json()};
 }
 for (const stage of ['AREA_DIRECTOR','VICE_RECTOR']) {
  await FinancialRequest.collection.updateOne({_id:requestId},{$set:{approvalStage:stage,'approvalRouteSnapshot.0.approvalLevel':stage}});
  for (const item of users) {
   const response = await call(item,`/requests/${requestId}`);
   assert.equal(response.status,200,JSON.stringify(response));
   const actions = response.body.data.allowedActions;
   const expected = item.label==='Admin' || (stage==='AREA_DIRECTOR'?item.label==='Director':item.label==='Vice Rector');
   assert.equal(actions.includes('APPROVE'),expected,`${item.label} ${stage}`);
   results.push({role:item.label,stage,actions});
   if (!expected) {
    const denied = await call(item,`/approvals/${requestId}/approve`,'POST');
    assert.ok([403,409].includes(denied.status),JSON.stringify(denied));
   }
  }
 }
 const admin=users.at(-1);
 for (const status of ['RECHAZADO','ANULADO','CERRADO','PAGADO_CERRADO']) {
  await FinancialRequest.collection.updateOne({_id:requestId},{$set:{status}});
  for(const item of users) {
   const response=await call(item,`/requests/${requestId}`);
   assert.equal(response.status,200,JSON.stringify(response));
   assert.deepEqual(response.body.data.allowedActions,[]);
  }
  const denied=await call(admin,`/approvals/${requestId}/approve`,'POST');
  assert.ok([403,409].includes(denied.status),JSON.stringify(denied));
 }
 await FinancialRequest.collection.updateOne({_id:requestId},{$set:{status:'PAGADO'}});
 const filtered=await call(admin,'/requests?renditionStatus=PENDING');
 assert.equal(filtered.status,200,JSON.stringify(filtered));
 assert.equal(filtered.body.data.length,1);
 assert.equal(filtered.body.data[0].status,'PAGADO');
 const excluded=await call(admin,'/requests?renditionStatus=SUBMITTED');
 assert.equal(excluded.body.data.length,0);
 const unauth=await fetch(`http://127.0.0.1:${server.address().port}/api/requests`);
 assert.equal(unauth.status,401);
 console.log('PASS: eight roles, two stages, denied approval calls, four terminal statuses, direct rendition filters, authentication');
 await fs.writeFile(new URL('./api-contract-evidence.json',import.meta.url),JSON.stringify({passed:true,results,terminalStatuses:['RECHAZADO','ANULADO','CERRADO','PAGADO_CERRADO'],renditionFilter:true},null,2));
} finally {
 await new Promise(resolve=>server.close(resolve));
 if(mongoose.connection.name===database) await mongoose.connection.dropDatabase();
 await mongoose.disconnect();
}
