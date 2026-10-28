import { Router } from "express";
import FinancialRequest from "../models/FinancialRequest.js";
import AccountsPayable from "../models/AccountsPayable.js";
import PaymentBatch from "../models/PaymentBatch.js";
import AuditLog from "../models/AuditLog.js";
import UmaSpecialExpense from "../models/UmaSpecialExpense.js";
import UmaInvestment from "../models/UmaInvestment.js";
import StatementReview from "../models/StatementReview.js";
import Supplier from "../models/Supplier.js";
import { escapedRegex, parsePagination } from "../services/queryService.js";
import { protect, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
const FINANCE = [ROLES.ADMIN, ROLES.GAF, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.MANAGEMENT, ROLES.AUDITOR, ROLES.SUPER_ADMIN];
router.use(protect, authorize(...FINANCE));
const csvCell = (value) => {
  const text = String(value ?? "").replace(/[\r\n]/g, " ");
  const escaped = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return `"${escaped.replace(/"/g, '""')}"`;
};
function dateFilter(query) {
  const after = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || "")) ? new Date(`${query.from}T00:00:00Z`) : null;
  const before = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || "")) ? new Date(`${query.to}T23:59:59.999Z`) : null;
  if (after && before && before < after) throw new AppError(422, "Invalid date range.");
  return { ...(after ? { $gte: after } : {}), ...(before ? { $lte: before } : {}) };
}
function auditWhere(query) {
  const where = {};
  const dates = dateFilter(query);
  if (Object.keys(dates).length) where.createdAt = dates;
  if (query.module) where.module = String(query.module).slice(0, 80);
  if (query.action) where.action = String(query.action).slice(0, 80);
  if (query.search) {
    const search = new RegExp(escapedRegex(String(query.search).slice(0, 100)), "i");
    where.$or = [{ requestNumber: search }, { action: search }, { module: search }];
  }
  return where;
}
router.get("/audit", asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const where = auditWhere(req.query);
  const fields = "createdAt actorName role module entityType requestNumber action statusFrom statusTo message blocked";
  const [data, total] = await Promise.all([AuditLog.find(where).select(fields).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(), AuditLog.countDocuments(where)]);
  res.json({ data, pagination: { total, page, pageSize } });
}));
router.get("/audit.csv", asyncHandler(async (req, res) => {
  const data = await AuditLog.find(auditWhere(req.query)).select("createdAt actorName role module requestNumber action statusFrom statusTo blocked").sort({ createdAt: -1 }).limit(10000).lean();
  const keys = ["createdAt", "actorName", "role", "module", "requestNumber", "action", "statusFrom", "statusTo", "blocked"];
  const csv = "\uFEFF" + keys.join(";") + "\r\n" + data.map(row => keys.map(k => csvCell(k === "createdAt" ? row[k]?.toISOString() : row[k])).join(";")).join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=UMA-auditoria.csv", "Cache-Control": "private, no-store" });
  res.send(csv);
}));
// The pilot's consultation topics return a uniform, non-sensitive report shape.
// No supplier bank details or employee identifiers are returned in these listings.
const CONSULTATION_TOPICS = Object.freeze(["requests","payables","actas","suppliers","bankBatches","statementReviews","specialExpenses","investments"]);
async function consultationRows(query, limit, skip) {
  const topic=String(query.topic||"requests");
  if (!CONSULTATION_TOPICS.includes(topic)) throw new AppError(422, `Available topics: ${CONSULTATION_TOPICS.join(", ")}`);
  const date=dateFilter(query),where={};
  if(Object.keys(date).length)where.createdAt=date;
  if(query.currency && ["PEN","USD"].includes(String(query.currency).toUpperCase()))where.currency=String(query.currency).toUpperCase();
  if(query.status)where.status=String(query.status).slice(0,60);
  let Model,fields,map;
  switch(topic){
    case "specialExpenses": Model=UmaSpecialExpense;fields="number type gross status createdAt";delete where.currency;map=r=>({reference:r.number,status:r.status,flowType:r.type,currency:"PEN",amount:r.gross,createdAt:r.createdAt});break;
    case "investments": Model=UmaInvestment;fields="number institution status currency principal createdAt";map=r=>({reference:r.number,status:r.status,flowType:"INV",currency:r.currency,amount:r.principal,createdAt:r.createdAt});break;
    case "statementReviews": Model=StatementReview;fields="sourceName bankName status createdAt";delete where.currency;map=r=>({reference:r.sourceName,status:r.status,flowType:"BANK_STATEMENT",currency:"",amount:"",createdAt:r.createdAt});break;
    case "bankBatches": Model=PaymentBatch;fields="batchNumber status currency totalAmount createdAt";map=r=>({reference:r.batchNumber,status:r.status,flowType:"TXT",currency:r.currency,amount:r.totalAmount,createdAt:r.createdAt});break;
    case "suppliers": Model=Supplier;fields="supplierCode name status createdAt";delete where.currency;map=r=>({reference:r.supplierCode||r.name,status:r.status,flowType:"PROVEEDOR",currency:"",amount:"",createdAt:r.createdAt});break;
    case "actas": Model=FinancialRequest;fields="requestNumber digitalActa.status currency totalAmount createdAt";delete where.status;where["digitalActa.status"]={$exists:true};map=r=>({reference:r.requestNumber,status:r.digitalActa?.status||"-",flowType:"ACTA",currency:r.currency,amount:r.totalAmount,createdAt:r.createdAt});break;
    case "payables": Model=AccountsPayable;fields="status request currency originalAmount createdAt";map=r=>({reference:String(r.request||""),status:r.status,flowType:"CXP",currency:r.currency,amount:r.originalAmount,createdAt:r.createdAt});break;
    default: Model=FinancialRequest;fields="requestNumber status flowType currency totalAmount createdAt";map=r=>({reference:r.requestNumber,status:r.status,flowType:r.flowType,currency:r.currency,amount:r.totalAmount,createdAt:r.createdAt});
  }
  const [raw,total]=await Promise.all([Model.find(where).select(fields).sort({createdAt:-1}).skip(skip).limit(limit).lean(),Model.countDocuments(where)]);
  return {data:raw.map(map),total};
}
router.get("/consultas.csv",asyncHandler(async(req,res)=>{
  const {data}=await consultationRows(req.query,10000,0);
  const keys=["reference","status","flowType","currency","amount","createdAt"];
  const csv="\uFEFF"+keys.join(";")+"\r\n"+data.map(r=>keys.map(k=>csvCell(k==="createdAt"&&r[k]?new Date(r[k]).toISOString():r[k])).join(";")).join("\r\n");
  res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=UMA-consultas.csv","Cache-Control":"private,no-store"});res.send(csv);
}));
router.get("/consultas", asyncHandler(async(req,res)=>{
 const {page,pageSize,skip}=parsePagination(req.query);
 const result=await consultationRows(req.query,pageSize,skip);
 res.json({data:result.data,pagination:{total:result.total,page,pageSize}});
}));
router.get("/indicadores", asyncHandler(async (req, res) => {
  const dates = dateFilter(req.query);
  const from = dates.$gte || new Date(Date.now() - 365 * 86400000);
  const to = dates.$lte || new Date();
  const [byStatus, byPriority, batches, specials, investments] = await Promise.all([
    FinancialRequest.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    FinancialRequest.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: "$priority", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    PaymentBatch.aggregate([{ $match: { generatedAt: { $gte: from, $lte: to } } }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$totalAmount" } } }]),
    UmaSpecialExpense.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: "$type", count: { $sum: 1 }, amount: { $sum: "$gross" } } }]),
    UmaInvestment.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
  ]);
  res.json({ data: { byStatus, byPriority, batches, specials, investments, period: { from, to } } });
}));
export default router;
