// Manual/local demo utility, not part of the production path.
// Additive, explicitly labelled presentation fixtures. Never calls external services.
// Default is dry-run. Existing records, credentials and configuration are never updated.
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveFinancialProgress } from '../../../../shared/workflowStatus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const key = 'uma-finance-presentation-v1';
const apply = process.argv.includes('--apply');
const expected = process.argv.find(x => x.startsWith('--database='))?.slice(11);
const uri = process.env.MONGODB_URI;
if (!uri || !expected) throw new Error('Explicit MONGODB_URI and --database=<name> required.');
if (!['uma_finance_triple_track_fresh', 'uma_finance_presentation_demo'].includes(expected) && !expected.startsWith('erp_presentation_test_')) throw new Error('Presentation seed is restricted to approved local demo/test databases.');
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//.test(uri)) throw new Error('Local MongoDB only.');
const models = {};
for (const name of ['User','CostCenter','ExpenseType','Supplier','FinancialRequest','BudgetAllocation','BudgetCommitment','BudgetException','PurchaseOrder','AccountsPayable','SunatVoucher','JournalEntry','PaymentBatch','Reconciliation','AuditLog','Notification']) models[name] = (await import(`../../../src/models/${name}.js`)).default;
const id = value => new mongoose.Types.ObjectId(crypto.createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0,24));
const money = value => Math.round(value * 100) / 100;
const date = new Date();
const year = date.getUTCFullYear();
const hour = 3600000;
const entries = [];
const files = [];
const plans = new Map();
function doc(name, identity, values, at = date) {
 const record = new models[name]({ _id: id(identity), ...values, createdAt: at, updatedAt: at });
 entries.push({ name, record }); return record;
}
// Small valid single-page PDFs with a prominent simulation notice.
function pdf(lines) {
 const clean = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ').replace(/[\\()]/g,'\\$&');
 const stream = `BT /F1 13 Tf 48 780 Td ${lines.map((line,i)=>`${i?'0 -25 Td ':''}(${clean(line)}) Tj`).join('\n')} ET`;
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let text='%PDF-1.4\n'; const offsets=[0];
 objects.forEach((object,index)=>{ offsets.push(Buffer.byteLength(text)); text+=`${index+1} 0 obj\n${object}\nendobj\n`; });
 const xref=Buffer.byteLength(text); text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(text);
}
function attachment(request, kind, label, actor) {
 const content=pdf(['UMA - DEMOSTRACION FINANCIERA','DOCUMENTO SIMULADO - SIN VALIDEZ FISCAL',label,request.requestNumber,request.description.slice(0,78),`Importe: ${request.currency} ${request.totalAmount || request.lines[0].totalAmount}`, 'No representa una operacion ni una aprobacion real.']);
 const filename=`${key}-${request._id}-${kind}-${request.attachments.length}.pdf`;
 const filePath=path.join(root,'backend/uploads/requests',String(request._id),filename);
 files.push({ path:filePath,content });
 request.attachments.push({kind,originalName:filename,filename,path:filePath,url:`/uploads/requests/${request._id}/${filename}`,mimetype:'application/pdf',size:content.length,checksum:crypto.createHash('sha256').update(content).digest('hex'),uploadedBy:actor,uploadedAt:request.issueDate});
}
const digest = value => crypto.createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(value)).digest('hex');
try {
 await mongoose.connect(uri,{autoIndex:false,autoCreate:false});
 const db=mongoose.connection.db;
 if(db.databaseName!==expected) throw new Error('Database mismatch.');
 const manifests=db.collection('demopresentationimports');
 const prior=await manifests.findOne({_id:key});
 if(prior?.status==='COMPLETE') { console.log(JSON.stringify({alreadyApplied:true,...prior.summary},null,2)); }
 else {
 const users=await models.User.find({active:true}).lean();
 const centerOrder=['CC-SAL','CC-ING','CC-FAR','CC-ADM','CC-INV','CC-REC'];
 const centers=(await models.CostCenter.find({active:true,code:/^CC-/}).lean()).sort((a,b)=>centerOrder.findIndex(prefix=>a.code.startsWith(prefix))-centerOrder.findIndex(prefix=>b.code.startsWith(prefix)));
 const expenses=await models.ExpenseType.find({active:true}).lean();
 const admin=users.find(x=>x.role==='Admin');
 const solicitor=users.find(x=>x.email==='demo.solicitante.salud@uma.edu.pe');
 if(!admin || !solicitor || centers.length<6 || !expenses.length) throw new Error('Expected UMA local demo master/users are missing. No changes made.');
 const actor=role=>(users.find(x=>x.role===role)||admin)._id;
 const suppliers=['Insumos Academicos Andinos','Tecnologia Educativa Campus','Mantenimiento Integral Universitario','Equipamiento Cientifico del Peru','Servicios Editoriales Aula','Logistica para Eventos Academicos'].map((name,index)=>doc('Supplier',`supplier-${index}`,{identifierType:'RUC',rucDni:`00000000${String(index+1).padStart(3,'0')}`,name:`DEMO - ${name}`,legalName:`DEMO - ${name}`,supplierCode:`PRV-${99000+index}`,active:false,homologationStatus:'PENDING_VALIDATION',proposalJustification:'Proveedor ficticio para presentacion. Identificador no valido para operaciones reales.'}));
 const topics=[['Equipamiento para practicas de laboratorio','Reactivos y material de bioseguridad','Mantenimiento de simuladores clinicos'],['Licencias para aulas virtuales','Renovacion de estaciones de trabajo','Soporte de conectividad del campus'],['Materiales para practicas de farmacia','Mantenimiento de equipos de investigacion','Insumos para proyectos de investigacion'],['Servicios de limpieza del campus','Materiales de oficina y archivo','Mantenimiento preventivo de instalaciones'],['Publicacion de resultados de investigacion','Organizacion de jornada cientifica','Suscripciones a bibliotecas digitales'],['Encuentro de coordinadores academicos','Material institucional para acreditacion','Equipos para salas de reuniones']];
 const currentStates=['BORRADOR','PENDIENTE_APROBACION','APROBADO_DIRECTOR','APROBADO_VICERRECTOR','COMPROMISO_PRESUPUESTAL','CONTABILIZADO','PROGRAMADO','TXT_GENERADO','PAGADO','CONCILIADO','CERRADO','RECHAZADO','DEVUELTO','OBSERVADO_PRESUPUESTO','ANULADO','TXT_GENERADO','PAGADO','PAGADO','PENDIENTE_APROBACION','APROBADO_DIRECTOR','CONTABILIZADO','PROGRAMADO','CONTABILIZADO','PENDIENTE_APROBACION'];
 const financial=['CONTABILIZADO','PROGRAMADO','TXT_GENERADO','PAGADO','CONCILIADO','CERRADO'];
 const requestSummaries=[];
 for(let n=0;n<54;n++) {
  const historical=n<30, slot=historical?n%6:(n-30)%6, center=centers[slot], supplier=suppliers[slot];
  const monthOffset=historical?5-Math.floor(n/6):0;
  const at=new Date(Date.UTC(year,date.getUTCMonth()-monthOffset,historical?8+(n%9):Math.max(1,date.getUTCDate()-5+(n%5)),10));
  const period=at.toISOString().slice(0,7), stageIndex=n-30;
  const status=historical?'CERRADO':currentStates[stageIndex];
  const flowType=[16,17].includes(stageIndex)?'C':n%5===0?'A2':n%5===3?'B':'A1';
  const capital=flowType!=='C'&&n%4===0;
  const expense=expenses.find(x=>x.category===(capital?'CAPEX':'OPEX'))||expenses[0];
  const currency=n%11===0?'USD':'PEN', rate=currency==='USD'?3.74:1;
  const net=flowType==='C'?5000:money((historical?2800+Math.floor(n/6)*690:4600)+(slot*1170)+(n%3)*830);
  const amount=flowType==='C'?net:money(net*1.18), pen=money(amount*rate);
  const project=`DEMO - ${['Laboratorios y docencia','Transformacion digital','Investigacion aplicada'][slot%3]}`;
  const owner=users.find(x=>x.role==='Solicitor'&&x.area===center.area)||solicitor;
  const stage=status==='PENDIENTE_APROBACION'?'AREA_DIRECTOR':status==='APROBADO_DIRECTOR'?'VICE_RECTOR':'COMPLETE';
  const due=new Date(date.getTime()+([1,18].includes(stageIndex)?-30:2)*hour);
  const request=doc('FinancialRequest',`request-${n}`,{developmentScenarioKey:`${key}-${n}`,requestNumber:`SOL-${year}-${String(900000+n).padStart(6,'0')}`,issueDate:at,accountingPeriod:period,requester:owner._id,solicitor:owner._id,requesterArea:center.area,requestingArea:center.area,requesterCostCenter:center._id,requesterCostCenterSnapshot:center,schoolOrDepartment:center.area,flowType,requestType:flowType==='C'?'ENTREGA_RENDIR':capital?'CAPEX':'OPEX',expenseNature:capital?'GOODS':'SERVICES',currency,exchangeRate:rate,exchangeRateDate:at,exchangeRateSource:currency==='USD'?'MANUAL DEMO - referencia simulada':'PEN',exchangeRateEvidence:{rate,date:at,requestedDate:at,source:'DEMO',authoritative:false,fallback:{used:true,reason:'SIMULATED_PRESENTATION_DATA'}},supplier:supplier._id,supplierSnapshot:{identifierType:'RUC',identifier:supplier.rucDni,legalName:supplier.legalName},project,description:`[DEMO] ${flowType==='C'?'Anticipo para jornada de extension universitaria':topics[slot][n%3]}`,businessJustification:'Escenario ficticio UMA para demostracion al departamento de Finanzas.',status,approvalStage:stage,approvalDueAt:stage==='COMPLETE'?undefined:due,lines:[{itemDescription:topics[slot][n%3],quantity:1,unitOfMeasure:'UNIT',unitPrice:amount,priceIncludesIGV:flowType==='C'?undefined:true,costCenter:center._id,costCenterSnapshot:center,expenseType:expense._id,expenseTypeSnapshot:expense,projectId:project,netAmount:net,igvAmount:money(amount-net),totalAmount:amount,currency,exchangeRate:rate}],approvalRouteSnapshot:[{sequence:1,role:'Approver',approvalLevel:'AREA_DIRECTOR',required:true,slaHours:4,status:stage==='AREA_DIRECTOR'?'PENDING':'APPROVED',startedAt:at,dueAt:due},{sequence:2,role:'Approver',approvalLevel:'VICE_RECTOR',required:true,slaHours:4,status:stage==='COMPLETE'?'APPROVED':'PENDING',startedAt:at,dueAt:due}],approvalHistory:[],attachments:[]},at);
  if(['BORRADOR','RECHAZADO','ANULADO','DEVUELTO'].includes(status)) { request.approvalRouteSnapshot=[]; request.approvalStage='AREA_DIRECTOR'; }
  if(!['BORRADOR','PENDIENTE_APROBACION','RECHAZADO','ANULADO','DEVUELTO'].includes(status)) request.approvalHistory.push({action:'DEMO_APPROVAL',actor:actor('Approver'),actorName:'Aprobacion simulada',role:'Approver',comments:'DEMO: historial de ejemplo; no es una firma real.',stage:'AREA_DIRECTOR',startedAt:at,completedAt:new Date(+at+(n%5+1)*hour),slaResult:n%7===0?'OVERDUE':'ON_TIME',createdAt:at});
  attachment(request,'SUPPORTING','Sustento de necesidad academica',owner._id);
  if(flowType==='A1') {
   if(capital) for(let q=1;q<=3;q++) attachment(request,'QUOTATION',`Cotizacion comparativa ${q} - propuesta de demostracion`,owner._id);
   else attachment(request,'CONTRACT','Acuerdo de servicio simulado',owner._id);
  }
  const accounted=financial.includes(status), reserved=accounted||status==='COMPROMISO_PRESUPUESTAL';
  const allPaid=['PAGADO','CONCILIADO','CERRADO'].includes(status), allReconciled=['CONCILIADO','CERRADO'].includes(status);
  const partial=stageIndex===15, childCount=partial||flowType==='A2'?2:1;
  let paidPen=0;
  const payables=[], reconciliations=[];
  let order;
  if(reserved&&['A1','A2'].includes(flowType)) {
   order=doc('PurchaseOrder',`order-${n}`,{poNumber:`DEMO-OC-${year}-${n+1}`,request:request._id,supplier:supplier._id,supplierSnapshot:{identifier:supplier.rucDni,legalName:supplier.legalName},amount,originalAmount:amount,consumedAmount:accounted?amount:0,currency,issueDate:at,status:'ISSUED',generatedBy:actor('Budget'),lines:[{itemDescription:request.description,quantity:1,unitPrice:amount,total:amount,costCenterCode:center.code,expenseAccount:expense.accountNumber}]},at);
   await order.validate(); request.purchaseOrder=order._id;
  }
  for(let child=0;accounted&&child<childCount;child++) {
   const value=childCount===1?amount:child===0?money(amount*.6):money(amount-money(amount*.6));
   const paid=allPaid||(partial&&child===0), childPen=money(value*rate);
   const ap=doc('AccountsPayable',`ap-${n}-${child}`,{request:request._id,purchaseOrder:order?._id,flowType,supplier:supplier._id,supplierIdentifierSnapshot:supplier.rucDni,voucher:{voucherType:flowType==='C'?'ADVANCE':'FACTURA',documentType:flowType==='C'?'ADVANCE':'FACTURA',series:'DEMO',number:`${900000+n}-${child+1}`,documentDate:at},originalAmount:value,currency,exchangeRate:rate,penEquivalent:childPen,outstandingAmount:paid?0:value,dueDate:new Date(+date+(child?10:-12-(n%4)*25)*86400000),status:paid?'PAID':status==='TXT_GENERADO'?'PAYMENT_FILE_CREATED':status==='PROGRAMADO'?'SCHEDULED':'OPEN',bankAccountSnapshot:{bank:'BBVA',currency,accountHolderName:'DEMO - SIN CUENTA BANCARIA REAL',verificationStatus:'PENDING'},scheduledFor:['PROGRAMADO','TXT_GENERADO'].includes(status)?date:undefined,history:[{status:'DEMO_IMPORTED',at,by:admin._id,comments:'Simulacion para presentacion; no transferir fondos.'}]},at);
   const journal=(type,debitAccount,creditAccount)=>doc('JournalEntry',`journal-${n}-${child}-${type}`,{entryNumber:`DEMO-${year}-${n}-${child}-${type}`,request:request._id,accountsPayable:ap._id,period,entryType:type,sourceTransaction:`DEMO-${key}-${n}-${child}-${type}`,currency,originalAmount:value,exchangeRate:rate,penEquivalent:childPen,lines:[{accountNumber:debitAccount,description:'DEMO - registro simulado',costCenter:center._id,expenseType:expense._id,debit:childPen,credit:0},{accountNumber:creditAccount,description:'DEMO - contrapartida simulada',debit:0,credit:childPen}],status:'POSTED',postedAt:at,generatedBy:actor('Accounting')},at);
   const provision=journal(flowType==='C'?'ADVANCE':'PROVISION',flowType==='C'?'1411':expense.accountNumber,'4212'); ap.provisionJournal=provision._id;
   if(flowType!=='C') {
    const basePEN=money(money(value/1.18)*rate);
    provision.lines[0].debit=basePEN;
    provision.lines.push({accountNumber:'40111',description:'DEMO - IGV credito fiscal simulado',debit:money(childPen-basePEN),credit:0});
   }
   if(flowType!=='C') {
    const voucher=doc('SunatVoucher',`voucher-${n}-${child}`,{request:request._id,accountsPayable:ap._id,purchaseOrder:order?._id,flowType,supplier:supplier._id,rucIssuer:supplier.rucDni,voucherType:'FACTURA',series:'DEMO',number:`${900000+n}-${child+1}`,seriesNumber:`DEMO-${900000+n}-${child+1}`,issueDate:at,currency,netAmount:money(value/1.18),igvAmount:money(value-money(value/1.18)),xmlAmount:value,validationStatus:'PENDING',sunatProvider:'DEMO',observationDetail:'Documento ficticio. No validado por SUNAT; excluido de exportacion fiscal.',validationEvidence:{valid:false,source:'DEMO',fiscal:{valid:false,voucherVerified:false,source:'DEMO'}}},at);
    ap.sunatVoucher=voucher._id;
   }
   if(paid) {
    paidPen+=childPen; const payment=journal('PAYMENT','4212','1041'); ap.paymentJournal=payment._id; ap.paidDate=at; ap.budgetPaidAt=at;
    request.payment.confirmations.push({accountsPayable:ap._id,operationNumber:`DEMO-NO-BANK-${n}-${child}`,paidAt:at,amount:value,confirmedAt:at,confirmedBy:actor('Treasury'),comments:'DEMO: pago simulado, sin movimiento bancario.'});
   }
   if(status==='TXT_GENERADO'&&!paid) {
    const fileName=`DEMO-NOT-FOR-BANK-${n}-${child}.txt`, filePath=path.join(root,'backend/generated/reports',fileName), content=Buffer.from('DEMO ONLY - NOT A BANK PAYMENT FILE. DO NOT UPLOAD.\n'); files.push({path:filePath,content});
    const batch=doc('PaymentBatch',`batch-${n}-${child}`,{batchNumber:`DEMO-BBVA-${year}-${n}-${child}`,bank:'BBVA',currency,paymentDate:date,items:[{accountsPayable:ap._id,request:request._id,requestNumber:request.requestNumber,supplier:supplier._id,supplierIdentifier:supplier.rucDni,supplierName:supplier.name,amount:value,currency,status:'INSTRUCTION_CREATED'}],totalAmount:value,fileName,filePath,url:`/generated/reports/${fileName}`,checksum:crypto.createHash('sha256').update(content).digest('hex'),adapterMode:'DEMO',specificationVersion:'SIMULATION-NOT-BANK-FORMAT',paymentCount:1,generatedAt:at,generatedBy:actor('Treasury')},at); ap.paymentBatch=batch._id; ap.$locals.batch=batch;
   }
   if(allReconciled) {
    if(child===0) reconciliations.push(doc('Reconciliation',`recon-${n}`,{request:request._id,scope:'REQUEST',accountsPayables:Array.from({length:childCount},(_,i)=>id(`ap-${n}-${i}`)),reconciledBy:actor('Accounting'),reconciledAt:at,bankReference:`DEMO-STATEMENT-${n}`,statementAmount:amount,paidAmount:amount,difference:0,comments:'Conciliacion simulada de todas las facturas indicadas. No se utilizo un estado bancario real.'},at));
    ap.reconciliation=id(`recon-${n}`); ap.reconciledAt=at;
   }
   ap.$locals.provision=provision; ap.$locals.payment=entries.find(x=>x.name==='JournalEntry'&&String(x.record._id)===String(ap.paymentJournal))?.record;
   payables.push(ap);
  }
  if(accounted) { request.accountsPayable=payables[0]._id; request.fiscalData={accountingDate:at,fiscalPeriod:period,processedAt:at,processedBy:actor('Accounting'),comments:'DEMO - contabilizacion ficticia'}; attachment(request,'CONFORMITY','Conformidad simulada de bienes o servicios',actor('Accounting')); }
  if(flowType==='C') { request.rendition.status=stageIndex===17?'SUBMITTED':'PENDING'; request.rendition.dueAt=new Date(+date+7*86400000); if(stageIndex===17) {request.rendition.amountRendered=4100; attachment(request,'RENDITION','Rendicion presentada - gastos simulados PEN 4100',owner._id);} }
  if(reserved) {
   const dimension=`${period.slice(0,4)}-${slot}-${expense._id}`;
   if(!plans.has(dimension)) plans.set(dimension,doc('BudgetAllocation',`plan-${dimension}`,{period:period.slice(0,4),planningMode:'ANNUAL_MONTHLY',costCenter:center._id,expenseType:expense._id,project,assignedAmount:0,committedAmount:0,executedAmount:0,paidAmount:0,months:Array.from({length:12},(_,i)=>({month:i+1,assignedAmount:0,committedAmount:0,executedAmount:0,paidAmount:0})),active:true}));
   const plan=plans.get(dimension), executed=accounted&&flowType!=='C'?pen:0, committed=money(pen-executed), bucket=plan.months[at.getUTCMonth()];
   for(const target of [plan,bucket]) { target.committedAmount=money(target.committedAmount+committed); target.executedAmount=money(target.executedAmount+executed); target.paidAmount=money(target.paidAmount+paidPen); }
   const commitment=doc('BudgetCommitment',`commitment-${n}`,{request:request._id,requestNumber:request.requestNumber,period,lines:[{allocation:plan._id,budgetMonth:at.getUTCMonth()+1,costCenter:center._id,expenseType:expense._id,project,amount:pen,executedAmount:executed,paidAmount:paidPen,mode:'ACTIVE'}],totalAmount:pen,executedAmount:executed,paidAmount:paidPen,status:'COMMITTED',createdBy:actor('Budget'),reservedAt:at,history:[{status:'COMMITTED',amount:pen,at,by:actor('Budget'),comments:'Reserva presupuestal simulada para demostracion.'}]},at); request.budgetCommitment=commitment._id;
  }
  if(reserved) {
   const commitment=entries.find(x=>x.name==='BudgetCommitment'&&String(x.record.request)===String(request._id)).record;
   commitment.status=status==='CERRADO'?'CLOSED':partial?'PARTIALLY_PAID':accounted&&flowType!=='C'?'EXECUTED':'COMMITTED';
   if(commitment.status!=='COMMITTED') commitment.history.push({status:commitment.status,amount:pen,at,by:admin._id,comments:'Estado final del escenario DEMO importado.'});
  }
  if(status==='OBSERVADO_PRESUPUESTO') doc('BudgetException',`exception-${n}`,{request:request._id,dimensionKey:`DEMO-${n}`,costCenter:center._id,expenseType:expense._id,project,strategy:'EXTRAORDINARY_APPROVAL',availableAmount:1000,requestedAmount:pen,requestedBy:owner._id,preparedBy:actor('Budget'),preparedAt:date,status:'PENDING',preparationComments:'DEMO - ampliacion de presupuesto pendiente de Gerencia',history:[{action:'DEMO_IMPORTED',by:admin._id,at:date,comments:'Caso simulado de insuficiencia presupuestal.'}]});
  doc('AuditLog',`audit-${n}`,{user:admin._id,actor:admin._id,actorName:'UMA DEMO importer',role:'Admin',entityType:'FinancialRequest',entity:'FinancialRequest',entityId:request._id,requestId:request._id,requestNumber:request.requestNumber,module:'DEMO',action:'DEMO_SCENARIO_IMPORTED',eventKey:`${key}-${n}`,statusTo:status,comments:'Escenario sintetico autorizado para presentacion. No representa evidencia financiera real.',newValues:{dataset:key,simulated:true,status}},date);
  await request.validate();
  if(accounted) {
   const progress=deriveFinancialProgress(request,payables.map(ap=>({...ap.toObject(),provisionJournal:ap.$locals.provision,paymentJournal:ap.$locals.payment,paymentBatch:ap.$locals.batch})),reconciliations,order);
   if(progress.status!==(status==='CERRADO'?'CONCILIADO':status)) throw new Error(`Inconsistent demo evidence: ${request.requestNumber} ${status} vs ${progress.status}`);
  }
  requestSummaries.push({requestNumber:request.requestNumber,description:request.description,flowType,status,period,amount,currency});
 }
 for(const plan of plans.values()) {
  const slot=centers.findIndex(x=>String(x._id)===String(plan.costCenter));
  for(const month of plan.months) month.assignedAmount=Math.ceil((month.committedAmount+month.executedAmount)/(0.43+slot*.065)/1000)*1000+6000;
  plan.assignedAmount=money(plan.months.reduce((sum,x)=>sum+x.assignedAmount,0)+12000);
 }
 for(const user of users.filter(x=>['Admin','Budget','Management','Accounting','Treasury','Approver'].includes(x.role))) doc('Notification',`notification-${user._id}`,{user:user._id,eventKey:`${key}-${user._id}`,type:'DEMO_PRESENTATION',title:'UMA - escenarios de demostracion disponibles',message:'Solicitudes, presupuestos y pagos identificados como DEMO. Todos los importes y documentos son ficticios.',path:user.role==='Approver'?'/approvals':user.role==='Treasury'?'/treasury':'/requests',entityType:'DEMO'});
 for(const {record} of entries) await record.validate();
 const summary={dataset:key,database:expected,mode:apply?'APPLY':'DRY_RUN',requests:requestSummaries.length,counts:Object.fromEntries([...new Set(entries.map(x=>x.name))].map(name=>[name,entries.filter(x=>x.name===name).length])),months:[...new Set(requestSummaries.map(x=>x.period))],documents:files.length,totalRequestPEN:money(entries.filter(x=>x.name==='FinancialRequest').reduce((sum,x)=>sum+x.record.totalPENEquivalent,0)),requestsByStatus:Object.fromEntries([...new Set(requestSummaries.map(x=>x.status))].map(status=>[status,requestSummaries.filter(x=>x.status===status).length]))};
 const originals=new Map();
 if(apply) {
  for(const name of new Set(entries.map(x=>x.name))) {const collection=models[name].collection; originals.set(name,await collection.find({}).sort({_id:1}).toArray());}
  const targets=new Set(entries.map(x=>String(x.record._id)));
  for(const [name,rows] of originals) for(const row of rows) if(targets.has(String(row._id))&&!prior) throw new Error(`Existing demo ID collision in ${name}; refusing overwrite.`);
  await manifests.updateOne({_id:key},{$setOnInsert:{status:'STARTED',startedAt:new Date(),summary}},{upsert:true});
  for(const file of files) {await fs.mkdir(path.dirname(file.path),{recursive:true}); try{await fs.writeFile(file.path,file.content,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error; if(digest(await fs.readFile(file.path))!==digest(file.content))throw new Error('Demo file collision; refusing overwrite.');}}
  for(const {name,record} of entries) await models[name].collection.updateOne({_id:record._id},{$setOnInsert:record.toObject({transform:false})},{upsert:true});
  for(const [name,rows] of originals) {const after=await models[name].collection.find({_id:{$in:rows.map(x=>x._id)}}).sort({_id:1}).toArray(); if(digest(rows)!==digest(after))throw new Error(`Existing records changed during seed: ${name}`);}
  summary.existingRecordsUnchanged=true;
  await manifests.updateOne({_id:key},{$set:{status:'COMPLETE',completedAt:new Date(),summary}});
 }
 await fs.mkdir(path.join(root,'data/reports/uma-presentation'),{recursive:true});
 await fs.writeFile(path.join(root,'data/reports/uma-presentation',apply?'applied.json':'dry-run.json'),JSON.stringify({summary,requests:requestSummaries},null,2));
 console.log(JSON.stringify(summary,null,2));
 }
} finally { await mongoose.disconnect(); }
