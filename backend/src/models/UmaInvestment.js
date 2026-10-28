import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 number:{type:String,unique:true,required:true,immutable:true},institution:{type:String,required:true,maxlength:180},currency:{type:String,enum:['PEN','USD'],required:true},
 principal:{type:Number,required:true,min:0.01},annualRate:{type:Number,min:0,max:100},startDate:{type:Date,required:true},maturityDate:{type:Date,required:true},days:{type:Number,min:1,max:360},estimatedInterest:{type:Number,min:0},
 status:{type:String,enum:['PROPOSED','ACTIVE','MATURED','CANCELLED'],default:'PROPOSED',index:true},certificateReference:{type:String,maxlength:100},
 createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},validatedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},validatedAt:Date,
 settledAt:Date,actualPrincipal:Number,actualInterest:Number,settlementReference:String,cancellationReason:String
},{timestamps:true});
schema.index({institution:1,currency:1,status:1,maturityDate:1});
export default mongoose.model('UmaInvestment',schema);
