import { Router } from "express";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rateLimit } from "express-rate-limit";
import WorkDraft from "../models/WorkDraft.js";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadFields } from "../middleware/upload.js";
import { validateUploadedFile } from "../services/storageService.js";
import { assertDraftScope, ownedDraft, saveWorkDraft, draftView, encryptDraft, decryptDraft } from "../services/workDraftService.js";
import { AppError } from "../utils/AppError.js";

const router = Router();
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "draftFiles" });
router.use(protect, (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.use(rateLimit({ windowMs: 60_000, limit: 240, keyGenerator: req => String(req.user._id), standardHeaders: true, legacyHeaders: false }));
router.get("/", asyncHandler(async (req, res) => {
  const query = { owner: req.user._id, closed: false };
  if (req.query.scope) { assertDraftScope(req.user, req.query.scope); query.scope = String(req.query.scope); }
  if (req.query.recordId) query.recordId = String(req.query.recordId);
  const rows = await WorkDraft.find(query).sort({ updatedAt: -1 }).limit(200);
  const visible = rows.filter(row => { try { assertDraftScope(req.user, row.scope); return true; } catch { return false; } });
  res.json({ data: visible.map(row => draftView(row)) });
}));
router.get("/:id", asyncHandler(async (req, res) => res.json({ data: draftView(await ownedDraft(req.user, req.params.id, true), true) })));
router.put("/:id", asyncHandler(async (req, res) => res.json({ data: await saveWorkDraft(req.user, req.params.id, req.body) })));
router.delete("/:id", asyncHandler(async (req, res) => {
  const draft = await ownedDraft(req.user, req.params.id);
  const revision = Number(req.query.revision);
  const result = await WorkDraft.updateOne({ _id: draft._id, owner: req.user._id, revision, closed: false }, { $set: { closed: true }, $unset: { payload: 1 }, $inc: { revision: 1 } });
  if (!result.modifiedCount) throw new AppError(409, "The draft changed in another session.", undefined, "DRAFT_CONFLICT");
  // Keep an empty tombstone to reject delayed writes after completion/discard.
  const files = await bucket().find({ "metadata.draftId": draft._id, "metadata.owner": String(req.user._id) }).toArray();
  await Promise.all(files.map(file => bucket().delete(file._id)));
  res.json({ success: true });
}));
router.post("/:id/files", asyncHandler(async (req, _res, next) => { await ownedDraft(req.user, req.params.id); next(); }), uploadFields, asyncHandler(async (req, res) => {
  const incoming = Object.values(req.files || {}).flat();
  try {
    if (incoming.length !== 1) throw new AppError(422, "Upload one draft attachment at a time.");
    const file = incoming[0];
    const checksum = await validateUploadedFile(file);
    const metadata = { draftId: req.params.id, owner: String(req.user._id), checksum, name: file.originalname, type: file.mimetype };
    let stored = await bucket().find({ "metadata.draftId": metadata.draftId, "metadata.owner": metadata.owner, "metadata.checksum": checksum }).next();
    if (!stored) {
      const count = await mongoose.connection.db.collection("draftFiles.files").countDocuments({ "metadata.draftId": metadata.draftId });
      if (count >= 100) throw new AppError(422, "This draft has reached its attachment limit.");
      const encrypted = encryptDraft(await fs.readFile(file.path));
      const stream = bucket().openUploadStream("private-draft-attachment", { metadata });
      await pipeline(Readable.from(encrypted), stream);
      stored = { _id: stream.id };
    }
    try { await ownedDraft(req.user, req.params.id); }
    catch (err) { await bucket().delete(stored._id); throw err; }
    res.json({ data: { __draftFile: String(stored._id), name: file.originalname, type: file.mimetype, size: file.size } });
  } finally { await Promise.all(incoming.map(file => fs.rm(file.path, { force: true }))); }
}));
router.get("/:id/files/:fileId", asyncHandler(async (req, res) => {
  await ownedDraft(req.user, req.params.id);
  if (!mongoose.isValidObjectId(req.params.fileId)) throw new AppError(404, "Attachment not found.");
  const file = await bucket().find({ _id: new mongoose.Types.ObjectId(req.params.fileId), "metadata.draftId": req.params.id, "metadata.owner": String(req.user._id) }).next();
  if (!file) throw new AppError(404, "Attachment not found.");
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(file._id)) chunks.push(chunk);
  res.set("Content-Type", "application/octet-stream").set("Content-Disposition", "attachment").send(decryptDraft(Buffer.concat(chunks)));
}));
export default router;
