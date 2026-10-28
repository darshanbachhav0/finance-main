import {Router} from 'express';
import UmaInvestment from '../models/UmaInvestment.js';
import {validateInvestment,concentrationAfter} from '../../../shared/umaInvestmentRules.mjs';
import {nextSequence} from '../services/sequenceService.js';
import {recordAudit} from '../services/auditService.js';
import {asyncHandler} from '../middleware/asyncHandler.js';
import {protect,authorize} from '../middleware/auth.js';
import {AppError} from '../utils/AppError.js';
import {ROLES} from '../utils/constants.js';
const router=Router();router.use(protect,authorize(ROLES.ADMIN,ROLES.TREASURY,ROLES.GAF,ROLES.ACCOUNTING,ROLES.AUDITOR,ROLES.MANAGEMENT,ROLES.SUPER_ADMIN));
router.get('/',asyncHandler(async(req,res)=>{
 const data=await UmaInvestment.find().select('-__v').sort({maturityDate:1}).limit(500).lean();
 res.json({data});
}));
router.get('/alerts',asyncHandler(async(req,res)=>{
 const next=new Date(Date.now()+30*86400000);
 const data=await UmaInvestment.find({status:'ACTIVE',maturityDate:{$lte:next}}).select('number institution currency principal maturityDate').sort({maturityDate:1}).limit(100).lean();
 res.json({data});
}));
router.post('/',authorize(ROLES.ADMIN,ROLES.TREASURY),asyncHandler(async(req,res)=>{
 let detail;try{detail=validateInvestment(req.body);}catch(e){throw new AppError(422,e.message);}
 if(new Date(detail.startDate)<new Date(Date.now()-86400000))throw new AppError(422,'No registre inversiones históricas como propuestas nuevas.');
 const number=`INV-${new Date().getFullYear()}-${String(await nextSequence('UMA_INVESTMENT',new Date().getFullYear())).padStart(4,'0')}`;
 const item=await UmaInvestment.create({...detail,number,createdBy:req.user._id});
 await recordAudit({entityType:'UmaInvestment',entity:item,action:'INVESTMENT_PROPOSED',module:'INVESTMENTS',user:req.user,req,newValues:{number,principal:item.principal,institution:item.institution}});
 res.status(201).json({data:item});
}));
router.post('/:id/approve',authorize(ROLES.GAF),asyncHandler(async(req,res)=>{
 const item=await UmaInvestment.findById(req.params.id);
 if(!item||item.status!=='PROPOSED')throw new AppError(409,'La inversión ya no está pendiente.');
 if(String(item.createdBy)===String(req.user._id))throw new AppError(403,'No puede aprobar su propia propuesta.');
 const portfolio=await UmaInvestment.find({status:'ACTIVE',currency:item.currency}).select('institution currency principal status').lean();
 const concentration=concentrationAfter(portfolio,{institution:item.institution,currency:item.currency,principal:item.principal,status:'ACTIVE'});
 if(concentration.share>0.5+1e-9)throw new AppError(409,`Concentración de ${(concentration.share*100).toFixed(1)}% excede el 50% permitido. Registre una propuesta de diversificación.`);
 // This records Finance's approval only. It does not move cash or create journals.
 item.status='ACTIVE';item.certificateReference=String(req.body.certificateReference||'').trim().slice(0,100);
 if(!item.certificateReference)throw new AppError(422,'Se requiere certificado bancario para confirmar la inversión.');
 item.validatedBy=req.user._id;item.validatedAt=new Date();await item.save();
 await recordAudit({entityType:'UmaInvestment',entity:item,action:'INVESTMENT_APPROVED',module:'INVESTMENTS',user:req.user,req,newValues:{number:item.number,status:'ACTIVE',certificateReference:item.certificateReference}});
 res.json({data:item});
}));
router.post('/:id/settle',authorize(ROLES.ADMIN,ROLES.TREASURY),asyncHandler(async(req,res)=>{
 const item=await UmaInvestment.findById(req.params.id);
 if(!item||item.status!=='ACTIVE')throw new AppError(409,'No se puede liquidar esta inversión.');
 const principal=Number(req.body.principal),interest=Number(req.body.interest),reference=String(req.body.reference||'').trim();
 if(!Number.isFinite(principal)||principal<0||!Number.isFinite(interest)||interest<0||!reference)throw new AppError(422,'Registre capital recibido, rendimiento y referencia bancaria.');
 item.status='MATURED';item.settledAt=new Date();item.actualPrincipal=principal;item.actualInterest=interest;item.settlementReference=reference.slice(0,120);await item.save();
 await recordAudit({entityType:'UmaInvestment',entity:item,action:'INVESTMENT_SETTLED',module:'INVESTMENTS',user:req.user,req,newValues:{number:item.number,capital:principal,interest,status:'MATURED'}});
 res.json({data:item});
}));
export default router;
