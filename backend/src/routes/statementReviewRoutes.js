import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import StatementReview from "../models/StatementReview.js";
import PaymentBatch from "../models/PaymentBatch.js";
import { parseStatement, candidateMatches } from "../services/statementCsv.js";
import { recordAudit } from "../services/auditService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { protect, authorizePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination } from "../services/queryService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_500_000, files: 1 } }).single("statement");
// Conciliaciones: Tesorería prepares, Contabilidad reviews and signs, the GAF and Auditoría read.
router.use(protect, authorizePermission(PERMISSIONS.RECONCILIATION_PREPARE, PERMISSIONS.RECONCILIATION_SIGN, PERMISSIONS.BATCH_APPROVE));
router.get("/", asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query);
  const [data, total] = await Promise.all([
    StatementReview.find({}).select("-lines").populate("importedBy reviewedBy", "name").sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    StatementReview.countDocuments()
  ]);
  res.json({ data, pagination: { total, page, pageSize } });
}));
router.get("/:id", asyncHandler(async (req, res) => {
  const item = await StatementReview.findById(req.params.id).populate("importedBy reviewedBy", "name").lean();
  if (!item) throw new AppError(404, "Statement review not found.");
  res.json({ data: item });
}));
router.post("/", authorizePermission(PERMISSIONS.RECONCILIATION_PREPARE), upload, asyncHandler(async (req, res) => {
  if (!req.file || !/\.csv$/i.test(req.file.originalname)) throw new AppError(422, "Upload a CSV statement.");
  const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  if (await StatementReview.exists({ checksum })) throw new AppError(409, "This statement was imported previously.");
  let lines;
  try { lines = parseStatement(req.file.buffer.toString("utf8")); }
  catch (error) { throw new AppError(422, error.message); }
  if (!lines.length) throw new AppError(422, "The statement has no movements.");
  const minDate = new Date(Math.min(...lines.map(line => +line.date)) - 3 * 86400000);
  const maxDate = new Date(Math.max(...lines.map(line => +line.date)) + 3 * 86400000);
  const batches = await PaymentBatch.find({ status: "CONFIRMED", paymentDate: { $gte: minDate, $lte: maxDate } }).select("_id batchNumber currency totalAmount paymentDate").lean();
  for (const line of lines) {
    const candidates = candidateMatches(line, batches);
    if (candidates.length === 1) { line.matchStatus = "SUGGESTED"; line.suggestedBatch = candidates[0].id; }
    else if (candidates.length > 1) { line.matchStatus = "AMBIGUOUS"; line.candidates = candidates.map(c => c.number); }
  }
  // Never assign the same confirmed bank batch to two different statement movements.
  const uses = new Map();
  for (const line of lines) if (line.suggestedBatch) {
    const key = String(line.suggestedBatch);
    uses.set(key, (uses.get(key) || 0) + 1);
  }
  for (const line of lines) if (line.suggestedBatch && uses.get(String(line.suggestedBatch)) > 1) {
    line.matchStatus = "AMBIGUOUS";
    line.candidates = [batches.find(b => String(b._id) === String(line.suggestedBatch))?.batchNumber].filter(Boolean);
    delete line.suggestedBatch;
  }
  const review = await StatementReview.create({ checksum, sourceName: req.file.originalname.slice(0, 200), bankName: String(req.body.bankName || "Banco").slice(0, 100), lines, importedBy: req.user._id });
  await recordAudit({ entityType: "StatementReview", entity: review, user: req.user, req, module: "RECONCILIATION", action: "STATEMENT_IMPORTED", newValues: { count: lines.length, matched: lines.filter(l => l.matchStatus === "SUGGESTED").length, checksum } });
  res.status(201).json({ data: review });
}));
router.post("/:id/prepare", authorizePermission(PERMISSIONS.RECONCILIATION_PREPARE), asyncHandler(async(req,res)=>{
 const item=await StatementReview.findById(req.params.id);
 if(!item)throw new AppError(404,"Statement review not found.");
 if(item.status!=="PENDING_ACCOUNTING")throw new AppError(409,"Statement is no longer editable.");
 const decisions=req.body.decisions;
 if(!Array.isArray(decisions)||decisions.length!==item.lines.length)throw new AppError(422,"Classify each statement line before signing.");
 const used=new Set();
 for(let i=0;i<decisions.length;i++){
  const decision=decisions[i];const line=item.lines[i];
  if(!["ACCEPT","UNIDENTIFIED","REJECT"].includes(decision?.decision))throw new AppError(422,`Line ${i+1}: choose a disposition.`);
  if(decision.decision==="ACCEPT"&&(!line.suggestedBatch||line.matchStatus!=="SUGGESTED"))throw new AppError(422,`Line ${i+1}: there is no unique matched batch.`);
  if(decision.decision!=="ACCEPT"&&!String(decision.notes||"").trim())throw new AppError(422,`Line ${i+1}: a reason is required.`);
  if(decision.decision==="ACCEPT"){
    const batchId=String(line.suggestedBatch);
    if(used.has(batchId))throw new AppError(409,"The same bank batch cannot be accepted twice in one statement.");
    used.add(batchId);
    const existing=await StatementReview.exists({_id:{$ne:item._id},status:{$in:["READY_FOR_ACCOUNTING","REVIEWED"]},lines:{$elemMatch:{suggestedBatch:line.suggestedBatch,reviewDecision:"ACCEPT"}}});
    if(existing)throw new AppError(409,`Line ${i+1}: this bank batch is already under review in another statement.`);
  }
  line.reviewDecision=decision.decision;line.reviewNotes=String(decision.notes||"").trim().slice(0,600);
 }
 item.status="READY_FOR_ACCOUNTING";item.preparedBy=req.user._id;item.preparedAt=new Date();await item.save();
 await recordAudit({entityType:"StatementReview",entity:item,user:req.user,req,module:"RECONCILIATION",action:"STATEMENT_PREPARED",newValues:{statementId:item.id,accepted:item.lines.filter(l=>l.reviewDecision==="ACCEPT").length,unidentified:item.lines.filter(l=>l.reviewDecision==="UNIDENTIFIED").length}});
 res.json({data:item});
}));
router.post("/:id/review", authorizePermission(PERMISSIONS.RECONCILIATION_SIGN), asyncHandler(async (req, res) => {
  const item = await StatementReview.findById(req.params.id);
  if (!item) throw new AppError(404, "Statement review not found.");
  if (item.status !== "READY_FOR_ACCOUNTING") throw new AppError(409, "Treasury must classify every movement before Accounting signs.");
  if (String(item.importedBy) === String(req.user._id) || String(item.preparedBy) === String(req.user._id)) throw new AppError(403, "The statement importer cannot also sign the review.");
  item.status = "REVIEWED";
  item.reviewedBy = req.user._id;
  item.reviewedAt = new Date();
  item.reviewNotes = String(req.body.notes || "").slice(0, 1000);
  await item.save();
  await recordAudit({ entityType: "StatementReview", entity: item, user: req.user, req, module: "RECONCILIATION", action: "STATEMENT_REVIEWED", newValues: { checksum: item.checksum, statementId: item.id } });
  res.json({ data: item });
}));
export default router;
