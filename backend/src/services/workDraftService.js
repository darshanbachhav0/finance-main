import crypto from "node:crypto";
import WorkDraft from "../models/WorkDraft.js";
import { AppError } from "../utils/AppError.js";

const roles = {
  request: ["Admin", "Solicitor"], supplier: ["Admin", "Accounting", "Solicitor"],
  "supplier-bank": ["Admin", "Accounting", "Solicitor"], "supplier-tax-review": ["Admin", "Accounting"], "supplier-finance-review": ["Admin", "Accounting"], "supplier-bank-review": ["Admin", "Accounting"],
  "employee-bank": ["Admin", "Solicitor"], rendition: ["Admin", "Solicitor"],
  "rendition-settlement": ["Admin", "Accounting", "Treasury"],
  "budget-plan": ["Admin", "Budget", "Accounting"], "budget-adjustment": ["Admin", "Budget", "Accounting"],
  "accounting-period": ["Admin", "Accounting"], fiscal: ["Admin", "Accounting"],
  "payment-confirmation": ["Admin", "Treasury"], "payment-bounce": ["Admin", "Treasury"],
  "payment-reprogram": ["Admin", "Treasury"], "payment-reconciliation": ["Admin", "Treasury"],
  "batch-invoice": ["Admin", "Accounting", "Solicitor"], "invoice-files": ["Admin", "Accounting", "Solicitor"],
  "invoice-resolution": ["Admin", "Accounting", "Solicitor"]
};
const resources = new Set(["cost-centers", "expense-types", "exchange-rates", "projects", "approval-rules", "budget-rules", "budget-allocations", "document-rules", "accounting-mappings", "bank-formats", "finance-configurations", "users"]);
export function assertDraftScope(user, scope) {
  if (typeof scope !== "string") throw new AppError(422, "Invalid draft form.");
  const resource = String(scope).replace(/^resource:/, "");
  const allowed = scope?.startsWith("resource:") && resources.has(resource)
    ? ["users", "approval-rules", "bank-formats", "finance-configurations"].includes(resource) ? ["Admin"]
      : ["budget-rules", "budget-allocations"].includes(resource) ? ["Admin", "Budget"] : ["Admin", "Accounting"] : roles[scope];
  if (!allowed?.includes(user.role)) throw new AppError(403, "Draft access is not available for this role.");
}
function key() {
  const secret = process.env.DRAFT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new AppError(503, "Draft encryption is not configured.");
  return crypto.createHash("sha256").update(`uma-private-drafts:${secret || "local-development-only"}`).digest();
}
export function encryptDraft(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
export function decryptDraft(buffer) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]);
}
export function draftView(draft, includeData = false) {
  const result = { _id: draft._id, scope: draft.scope, recordId: draft.recordId, route: draft.route, title: draft.title, revision: draft.revision, sourceVersion: draft.sourceVersion, updatedAt: draft.updatedAt };
  if (includeData) result.value = draft.payload ? JSON.parse(decryptDraft(draft.payload).toString("utf8")) : null;
  return result;
}
export async function ownedDraft(user, id, includeData = false) {
  const draft = await WorkDraft.findOne({ _id: id, owner: user._id, closed: false }).select(includeData ? "+payload" : "");
  if (!draft) throw new AppError(404, "Draft no longer exists.");
  assertDraftScope(user, draft.scope);
  return draft;
}
function rejectSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (/password|token|secret/i.test(name) && child) throw new AppError(422, "Credentials must not be stored in drafts.");
    rejectSecrets(child);
  }
}
export async function saveWorkDraft(user, id, body) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new AppError(422, "Invalid draft identifier.");
  assertDraftScope(user, body.scope);
  if (!Number.isInteger(body.revision) || body.revision < 0 || !/^[a-f0-9-]{36}$/.test(body.mutationId || "")) throw new AppError(422, "A draft revision and mutation identifier are required.");
  if (typeof body.route !== "string" || !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(body.route) || body.route.length > 200) throw new AppError(422, "Invalid draft route.");
  if (typeof body.recordId !== "string" || body.recordId.length > 100) throw new AppError(422, "Invalid draft record.");
  rejectSecrets(body.value);
  const json = JSON.stringify(body.value ?? null);
  if (Buffer.byteLength(json) > 1024 * 1024) throw new AppError(413, "This draft is too large.");
  const changes = { payload: encryptDraft(Buffer.from(json)), mutationId: body.mutationId, sourceVersion: String(body.sourceVersion || "").slice(0, 100), title: String(body.title || body.scope).slice(0, 100) };
  let draft = await WorkDraft.findOneAndUpdate({ _id: id, owner: user._id, scope: body.scope, recordId: body.recordId, revision: body.revision, closed: false }, { $set: changes, $inc: { revision: 1 } }, { new: true });
  if (!draft && body.revision === 0) {
    try { draft = await WorkDraft.create({ _id: id, owner: user._id, scope: body.scope, recordId: body.recordId, route: body.route, ...changes, revision: 1 }); }
    catch (err) { if (err.code !== 11000) throw err; }
  }
  if (!draft) {
    const previous = await WorkDraft.findOne({ _id: id, owner: user._id });
    if (previous && !previous.closed && previous.mutationId === body.mutationId) return draftView(previous);
    throw new AppError(409, "This draft changed in another session. Reload the saved version or keep your work as a separate draft.", undefined, "DRAFT_CONFLICT");
  }
  return draftView(draft);
}
