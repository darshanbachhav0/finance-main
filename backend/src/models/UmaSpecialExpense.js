import mongoose from 'mongoose';
const schema=new mongoose.Schema({
  number:{type:String,unique:true,immutable:true,required:true},
  type:{type:String,enum:['M','H','E'],required:true,index:true},
  costCenter:{type:mongoose.Schema.Types.ObjectId,ref:'CostCenter',required:true,index:true},
  creator:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  details:{type:mongoose.Schema.Types.Mixed,required:true},
  gross:{type:Number,min:0,required:true},
  net:{type:Number,min:0,required:true},
  evidence:{fileName:String,hash:String,contentType:String,assetPath:{type:String,select:false}},
  revisions:[{at:Date,by:{type:mongoose.Schema.Types.ObjectId,ref:'User'},oldHash:String,oldStatus:String,notes:String}],
  status:{type:String,enum:['PENDING_REVIEW','OBSERVED','APPROVED_FOR_ACCOUNTING'],default:'PENDING_REVIEW',index:true},
  reviewStages:{type:[{stage:{type:String,enum:['LEGAL','DIRECTOR','SUPERIOR','GAF','GG']},actor:{type:mongoose.Schema.Types.ObjectId,ref:'User'},signedAt:Date}],default:[]},
  reviewIndex:{type:Number,default:0,min:0},
  reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},
  reviewedAt:Date,
  reviewReason:{type:String,maxlength:1000}
},{timestamps:true});
schema.index({costCenter:1,createdAt:-1});
export default mongoose.model('UmaSpecialExpense',schema);
