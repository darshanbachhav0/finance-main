import {Router} from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import {validateSpecialExpense} from '../../../shared/umaSpecialRules.mjs';
import UmaSpecialExpense from '../models/UmaSpecialExpense.js';
import CostCenter from '../models/CostCenter.js';
import {nextSequence} from '../services/sequenceService.js';
import {loadCascade,superiorCostCenterIn} from '../services/costCenterCascadeService.js';
import {uploadRoot} from '../services/storageService.js';
import {archiveAsset,readAsset} from '../services/durableAssetService.js';
import {recordAudit} from '../services/auditService.js';
import {asyncHandler} from '../middleware/asyncHandler.js';
import {protect} from '../middleware/auth.js';
import {PERMISSIONS,ROLES,SCOPES} from '../utils/constants.js';
import {hasPermission,hasRole,requestViewScope} from '../utils/permissions.js';
import {AppError} from '../utils/AppError.js';
import {parsePagination} from '../services/queryService.js';
import {getEffectiveFinanceConfiguration} from '../services/financeConfigurationService.js';
import {FINANCE_CONFIGURATION_KEYS,DEFAULT_UIT_VALUE} from '../utils/constants.js';

const router=Router();
// Processes M (movilidad), H (honorarios) and E (devoluciones), per the Manual de usuario:
// the area registers M and E (request.create), only Gestión de Personas uploads H batches
// (honorarios.manage). Routes: E = Legal -> responsable -> GAF above 5 UIT; M and H = responsable
// -> GAF. The finance roles and Auditoría read every record (request.view, UNIVERSITY); Legal reads
// the E cases and Gestión de Personas the H batches; everyone else their own and their cost center's.
const mayRegister={M:(user)=>hasPermission(user,PERMISSIONS.REQUEST_CREATE),H:(user)=>hasPermission(user,PERMISSIONS.HONORARIOS_MANAGE),E:(user)=>hasPermission(user,PERMISSIONS.REQUEST_CREATE)};
const readsAll=(user)=>requestViewScope(user)===SCOPES.UNIVERSITY;
const specialistTypes=(user)=>[...(hasPermission(user,PERMISSIONS.LEGAL_REVIEW)?['E']:[]),...(hasPermission(user,PERMISSIONS.HONORARIOS_MANAGE)?['H']:[])];
// Approval route of each process (Manual técnico, "Rutas"): E = Legal -> responsable -> GAF above
// 5 UIT (never Gerencia General); H = responsable -> GAF whatever the amount; M follows the base
// route: responsable -> superior in the cascade -> GAF above 5 UIT -> Gerencia General above 20 UIT.
// The superior step is skipped when the cost center has none, or when it is the same person.
async function superiorResponsible(center){
 if(!center)return null;
 const cascade=await loadCascade();
 const superior=superiorCostCenterIn(cascade,cascade.byId.get(key(center._id))||center);
 return superior?.responsible&&key(superior.responsible)!==key(center.responsible)?superior.responsible:null;
}
export async function routeStages(type,gross,uit,center){
 if(type==='E')return ['LEGAL','DIRECTOR',...(gross>5*uit?['GAF']:[])];
 if(type==='H')return ['DIRECTOR','GAF'];
 return ['DIRECTOR',...(await superiorResponsible(center)?['SUPERIOR']:[]),...(gross>5*uit?['GAF']:[]),...(gross>20*uit?['GG']:[])];
}
const fileUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}}).single('evidence');
const key=id=>String(id?._id||id||'');
function canAccess(user,entry){return readsAll(user)||specialistTypes(user).includes(entry.type)||key(user.costCenter)===key(entry.costCenter)||key(user._id)===key(entry.creator);}
router.use(protect);
router.get('/',asyncHandler(async(req,res)=>{
 const {page,pageSize,skip}=parsePagination(req.query);
 const filter=readsAll(req.user)?{}:{$or:[{creator:req.user._id},{costCenter:req.user.costCenter},...(specialistTypes(req.user).length?[{type:{$in:specialistTypes(req.user)}}]:[])]};
 if(['M','H','E'].includes(req.query.type))filter.type=req.query.type;
 const [data,total]=await Promise.all([UmaSpecialExpense.find(filter).select('-details.studentCode').sort({createdAt:-1}).skip(skip).limit(pageSize).lean(),UmaSpecialExpense.countDocuments(filter)]);
 res.json({data,pagination:{page,pageSize,total}});
}));
router.post('/',fileUpload,asyncHandler(async(req,res)=>{
 const type=String(req.body.type||'').toUpperCase();
 if(!mayRegister[type]?.(req.user))throw new AppError(403,'Su rol no puede registrar este tipo de solicitud.');
 const costCenterId=String(req.body.costCenter||'');
 if(!/^[a-f\d]{24}$/i.test(costCenterId))throw new AppError(422,'Seleccione un centro de costo válido.');
 const costCenter=await CostCenter.findById(costCenterId).lean();
 if(!costCenter||costCenter.active===false)throw new AppError(422,'Centro de costo inactivo o inexistente.');
 if(key(costCenter._id)!==key(req.user.costCenter))throw new AppError(403,'No puede usar un centro de costo ajeno.');
 let payload;
 try{payload=JSON.parse(req.body.details||'{}');}catch{throw new AppError(422,'Datos de formulario inválidos.');}
 let parsed;
 try{parsed=validateSpecialExpense(type,payload);}catch(e){throw new AppError(422,e.message);}
 if(type==='M'&&!parsed.employee)throw new AppError(422,'Indique al trabajador.');
 if(!req.file||req.file.buffer.subarray(0,5).toString()!=='%PDF-')throw new AppError(422,'Adjunte el sustento firmado en PDF.');
 // Draft records are explicitly NOT payable; dedicated Accounting posting requires separate authorization.
 const folder=path.join(uploadRoot,'special-expenses');await fs.mkdir(folder,{recursive:true});
 const assetPath=path.join(folder,`${crypto.randomUUID()}.pdf`);
 await fs.writeFile(assetPath,req.file.buffer,{flag:'wx'});await archiveAsset(assetPath);
 const number=`${type}-${new Date().getFullYear()}-${String(await nextSequence(`UMA_SPECIAL_${type}`,new Date().getFullYear())).padStart(5,'0')}`;
 const gross=parsed.gross??parsed.amount;
 const uit=(await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.UIT_VALUE))?.numericValue||DEFAULT_UIT_VALUE;
 const stages=await routeStages(type,gross,uit,costCenter);
 const doc=await UmaSpecialExpense.create({number,type,costCenter:costCenter._id,creator:req.user._id,details:parsed,gross,net:parsed.net??gross,reviewStages:stages.map(stage=>({stage})),evidence:{fileName:req.file.originalname.slice(0,180),hash:crypto.createHash('sha256').update(req.file.buffer).digest('hex'),contentType:'application/pdf',assetPath}});
 await recordAudit({entityType:'UmaSpecialExpense',entity:doc,action:'SPECIAL_EXPENSE_REGISTERED',module:'SPECIAL_EXPENSES',user:req.user,req,newValues:{number,type,status:doc.status,gross:doc.gross}});
 res.status(201).json({data:doc});
}));
router.post('/:id/resubmit',fileUpload,asyncHandler(async(req,res)=>{
 const doc=await UmaSpecialExpense.findById(req.params.id).select('+evidence.assetPath');
 if(!doc)throw new AppError(404,'Registro no encontrado.');
 if(String(doc.creator)!==String(req.user._id)||doc.status!=='OBSERVED')throw new AppError(403,'Solo el solicitante puede corregir una observación.');
 let payload;try{payload=JSON.parse(req.body.details||'{}');}catch{throw new AppError(422,'Formulario inválido.');}
 let parsed;try{parsed=validateSpecialExpense(doc.type,payload);}catch(e){throw new AppError(422,e.message);}
 if(doc.type==='M'&&!parsed.employee)throw new AppError(422,'Indique al trabajador.');
 if(!req.file||req.file.buffer.subarray(0,5).toString()!=='%PDF-')throw new AppError(422,'Adjunte el sustento corregido en PDF.');
 const previousHash=doc.evidence.hash,folder=path.join(uploadRoot,'special-expenses');await fs.mkdir(folder,{recursive:true});
 const assetPath=path.join(folder,`${crypto.randomUUID()}.pdf`);await fs.writeFile(assetPath,req.file.buffer,{flag:'wx'});await archiveAsset(assetPath);
 const gross=parsed.gross??parsed.amount,uit=(await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.UIT_VALUE))?.numericValue||DEFAULT_UIT_VALUE;
 const stages=await routeStages(doc.type,gross,uit,await CostCenter.findById(doc.costCenter).lean());
 doc.revisions.push({at:new Date(),by:req.user._id,oldHash:previousHash,oldStatus:doc.status,notes:doc.reviewReason});
 doc.details=parsed;doc.gross=gross;doc.net=parsed.net??gross;doc.status='PENDING_REVIEW';doc.reviewIndex=0;doc.reviewStages=stages.map(stage=>({stage}));doc.reviewReason='';
 doc.evidence={fileName:req.file.originalname.slice(0,180),hash:crypto.createHash('sha256').update(req.file.buffer).digest('hex'),contentType:'application/pdf',assetPath};
 await doc.save();
 await recordAudit({entityType:'UmaSpecialExpense',entity:doc,action:'SPECIAL_EXPENSE_RESUBMITTED',module:'SPECIAL_EXPENSES',user:req.user,req,oldValues:{hash:previousHash,status:'OBSERVED'},newValues:{hash:doc.evidence.hash,status:doc.status,gross}});
 res.json({data:doc});
}));
router.get('/:id/evidence',asyncHandler(async(req,res)=>{
 const doc=await UmaSpecialExpense.findById(req.params.id).select('+evidence.assetPath');
 if(!doc)throw new AppError(404,'Registro no encontrado.');
 if(!canAccess(req.user,doc))throw new AppError(403,'No autorizado.');
 const bytes=await readAsset(doc.evidence.assetPath);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==doc.evidence.hash)throw new AppError(409,'El archivo fue alterado.');
 res.set({'Content-Type':'application/pdf','Content-Disposition':'inline; filename="sustento.pdf"','Cache-Control':'private,no-store'}).send(bytes);
}));
// Who decides each stage is contextual: Legal for LEGAL, the cost center's responsible for DIRECTOR,
// the GAF for GAF. Nobody reviews a record they registered.
router.post('/:id/review',asyncHandler(async(req,res)=>{
 const doc=await UmaSpecialExpense.findById(req.params.id);
 if(!doc)throw new AppError(404,'Registro no encontrado.');
 if(doc.status!=='PENDING_REVIEW')throw new AppError(409,'Solo pueden revisarse registros pendientes; los observados necesitan corrección antes de continuar.');
 if(key(doc.creator)===key(req.user._id))throw new AppError(403,'No se permite la autoaprobación.');
 const center=await CostCenter.findById(doc.costCenter).lean();
 const stage=doc.reviewStages[doc.reviewIndex]?.stage;
 if(!stage)throw new AppError(409,'No quedan revisiones pendientes.');
 const authorized=stage==='LEGAL'?hasPermission(req.user,PERMISSIONS.LEGAL_REVIEW):stage==='GAF'?hasRole(req.user,ROLES.GAF):stage==='GG'?hasRole(req.user,ROLES.MANAGEMENT):stage==='SUPERIOR'?key(await superiorResponsible(center))===key(req.user._id):key(center?.responsible)===key(req.user._id);
 if(!authorized)throw new AppError(403,`La etapa ${stage} requiere el responsable autorizado.`);
 // One person signs one stage of a record: a second signature by the same authority adds no control.
 if(req.body.status!=='OBSERVED'&&doc.reviewStages.some(item=>item.actor&&key(item.actor)===key(req.user._id)))throw new AppError(403,'Ya firmó otra etapa de este registro; la siguiente etapa corresponde a otra persona.');
 if(!['OBSERVED','APPROVED_FOR_ACCOUNTING'].includes(req.body.status))throw new AppError(422,'Estado inválido.');
 const reason=String(req.body.reason||'').trim().slice(0,1000);
 if(req.body.status==='OBSERVED'&&!reason)throw new AppError(422,'Se requiere motivo para observar.');
 const previous=doc.status,oldIndex=doc.reviewIndex;
 if(req.body.status==='OBSERVED'){doc.status='OBSERVED';doc.reviewReason=reason;}
 else {
   doc.reviewStages[oldIndex].actor=req.user._id;doc.reviewStages[oldIndex].signedAt=new Date();
   doc.reviewIndex+=1;doc.status=doc.reviewIndex>=doc.reviewStages.length?'APPROVED_FOR_ACCOUNTING':'PENDING_REVIEW';
   doc.reviewReason='';
 }
 doc.reviewedBy=req.user._id;doc.reviewedAt=new Date();
 // A conditional write prevents two review actions for the same stage racing each other.
 const result=await UmaSpecialExpense.findOneAndUpdate({_id:doc._id,status:previous,reviewIndex:oldIndex},{$set:{reviewStages:doc.reviewStages,reviewIndex:doc.reviewIndex,status:doc.status,reviewReason:doc.reviewReason,reviewedBy:doc.reviewedBy,reviewedAt:doc.reviewedAt}},{new:true,runValidators:true});
 if(!result)throw new AppError(409,'Otro usuario modificó esta revisión; vuelva a cargar la página.');
 await recordAudit({entityType:'UmaSpecialExpense',entity:result,action:'SPECIAL_EXPENSE_STAGE_REVIEWED',module:'SPECIAL_EXPENSES',user:req.user,req,oldValues:{status:previous,index:oldIndex},newValues:{status:result.status,stage,reason}});
 res.json({data:result});
}));
export default router;
