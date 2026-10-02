import mongoose from "mongoose";
import crypto from "node:crypto";
import AccountsPayable from "../models/AccountsPayable.js";
import Reconciliation from "../models/Reconciliation.js";
import { reconcilePayment } from "./treasuryService.js";
import { recordAudit } from "./auditService.js";
import { AppError } from "../utils/AppError.js";

const schema = new mongoose.Schema({ owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, checksum: String, rows: [mongoose.Schema.Types.Mixed] }, { timestamps: true });
const StatementImport = mongoose.models.StatementImport || mongoose.model("StatementImport", schema);
// A global evidence claim prevents re-uploading a row to reconcile another payable.
// Claims remain after failures: Accounting must inspect uncertain outcomes, never retry blindly.
const claimSchema = new mongoose.Schema({ _id: String, statement: mongoose.Schema.Types.ObjectId, payable: mongoose.Schema.Types.ObjectId, user: mongoose.Schema.Types.ObjectId, outcome: String }, { timestamps: true });
const StatementClaim = mongoose.models.StatementClaim || mongoose.model("StatementClaim", claimSchema);
export const statementRowKey = row => crypto.createHash("sha256").update(JSON.stringify([row.date, row.reference, row.currency, Math.round(row.amount * 100)])).digest("hex");
export function parseStatementCsv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) throw new AppError(422, "Upload a CSV smaller than 1 MB.");
  const records = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ""; }
    else if (c === '\n' && !quoted) { row.push(cell.trim()); if (row.some(Boolean)) records.push(row); row = []; cell = ""; }
    else if (c !== '\r') cell += c;
  }
  if (quoted) throw new AppError(422, "CSV contains an unclosed quoted field.");
  row.push(cell.trim()); if (row.some(Boolean)) records.push(row);
  const headers = records.shift()?.map(s => s.replace(/^\uFEFF/, "").toLowerCase());
  if (headers?.join(',') !== "date,reference,currency,amount") throw new AppError(422, "CSV columns must be date,reference,currency,amount. Use positive debit amounts and YYYY-MM-DD dates.");
  if (!records.length || records.length > 100) throw new AppError(422, "Import between 1 and 100 statement rows.");
  const seen = new Set();
  return records.map((values, index) => {
    const [date, reference, currency, amount] = values;
    if (values.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !reference || reference.length > 100 || !["PEN", "USD"].includes(currency) || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !Number.isSafeInteger(Math.round(Number(amount) * 100))) throw new AppError(422, `Correct statement row ${index + 2}.`);
    const key = `${date}|${reference}|${currency}|${Math.round(Number(amount) * 100)}`;
    if (seen.has(key)) throw new AppError(422, `Duplicate statement row ${index + 2}.`);
    seen.add(key);
    return { date, reference, currency, amount: Number(amount) };
  });
}
export function matchingPayables(row, payables) {
  return payables.filter(ap => {
    const confirmations = (ap.request?.payment?.confirmations || []).filter(c => String(c.accountsPayable) === String(ap._id));
    const total = confirmations.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    return ap.currency === row.currency && Math.round(total * 100) === Math.round(row.amount * 100)
      && confirmations.length > 0 && confirmations.every(c => c.operationNumber === row.reference)
      && confirmations.some(c => Math.abs(Date.parse(c.paidAt || ap.paidDate) - Date.parse(row.date)) <= 3 * 86400000);
  }).map(ap => ({ payableId: String(ap._id), requestId: String(ap.request._id), requestNumber: ap.request.requestNumber }));
}
async function candidates(rows) {
  const payables = await AccountsPayable.find({ status: "PAID", reconciliation: null, currency: { $in: [...new Set(rows.map(r => r.currency))] } }).populate("request", "payment requestNumber").limit(2001).lean();
  if (payables.length > 2000) throw new AppError(422, "Too many unreconciled payables. Reconcile older records before requesting suggestions.");
  const claims = await StatementClaim.find({ _id: { $in: rows.map(statementRowKey) } }).lean();
  const used = new Set(claims.map(c => c._id));
  const historical = await Reconciliation.find({ bankReference: { $in: rows.map(row => row.reference) } }).select("bankReference currency statementAmount").lean();
  // Older/manual reconciliations have no import key. A matching reference and amount
  // is uncertain evidence, so leave it for a human rather than offering it again.
  for (const row of rows) if (historical.some(r => r.bankReference === row.reference && (!r.currency || r.currency === row.currency) && Math.round(r.statementAmount * 100) === Math.round(row.amount * 100))) used.add(statementRowKey(row));
  return rows.map(row => ({ ...row, claimed: used.has(statementRowKey(row)), candidates: used.has(statementRowKey(row)) ? [] : matchingPayables(row, payables) }));
}
export async function importStatement(text, user, req) {
  const rows = parseStatementCsv(text);
  const record = await StatementImport.create({ owner: user._id, checksum: crypto.createHash("sha256").update(text).digest("hex"), rows });
  await recordAudit({ entityType: "StatementImport", entity: record, action: "STATEMENT_IMPORTED", user, req, module: "TREASURY", newValues: { checksum: record.checksum, rows: rows.length } });
  return { id: record._id, rows: await candidates(rows), note: "Suggestions only. Partial and ambiguous matches require manual review." };
}
export async function confirmStatementMatch({ id, rowIndex, payableId, user, req }) {
  const statement = await StatementImport.findOne({ _id: id, owner: user._id });
  if (!statement) throw new AppError(404, "Statement import not found.");
  const row = Number.isInteger(rowIndex) ? statement.rows[rowIndex] : null;
  if (!row) throw new AppError(422, "Select a statement row.");
  const [suggestion] = await candidates([row]);
  if (suggestion.candidates.length !== 1 || suggestion.candidates[0].payableId !== payableId) throw new AppError(409, "This match is ambiguous, already claimed or no longer eligible. Review manually in Treasury.");
  const key = statementRowKey(row);
  try { await StatementClaim.create({ _id: key, statement: statement._id, payable: payableId, user: user._id, outcome: "PENDING" }); }
  catch (error) { if (error.code === 11000) throw new AppError(409, "This statement row was already claimed. Review its reconciliation before continuing."); throw error; }
  // Reuses final backend payment, period and reconciliation controls.
  try {
    const result = await reconcilePayment({ accountsPayableId: payableId, payload: { bankReference: row.reference, statementAmount: row.amount, currency: row.currency, comments: `Statement ${statement._id}; SHA256 ${statement.checksum}; row ${rowIndex + 2}; bank date ${row.date}` }, user, req });
    await StatementClaim.updateOne({ _id: key }, { $set: { outcome: "RECONCILED" } });
    return result;
  } catch (error) { await StatementClaim.updateOne({ _id: key }, { $set: { outcome: "REVIEW_REQUIRED" } }); throw error; }
}
