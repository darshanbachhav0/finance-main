import crypto from "crypto";
import AccountsPayable from "../models/AccountsPayable.js";
import GeneratedFile from "../models/GeneratedFile.js";
import PaymentBatch from "../models/PaymentBatch.js";
import { recordAudit } from "./auditService.js";
import { readAsset } from "./durableAssetService.js";
import { notificationText, notifyRoles, resolveNotification } from "./notificationService.js";
import { bouncedDestinationStillVerified } from "./paymentDestinationService.js";
import { escapedRegex, paginatedPayload, parsePagination, parseSort, withDeepLink } from "./queryService.js";
import { assertNoBlockingObservation, cancelPaymentBatch } from "./treasuryService.js";
import { AppError } from "../utils/AppError.js";
import { BANK_FILE_VERIFICATION, bankFileVerificationStatus, bankFileVerificationTaskKey, paymentDateWarning } from "../utils/bankFileVerification.js";
import { AP_STATUS, ERROR_CODES, ROLES } from "../utils/constants.js";
import { moneyEquals, sumMoney } from "../utils/money.js";

// Accounting verifies each generated bank TXT before Treasury may download it and send it to the
// bank. Verifying re-runs the checks the system can make; rejecting cancels the file, so its CXPs
// return to Treasury's queue to be corrected and generated again.

const activeItems = (batch) => (batch.items || []).filter((item) => item.status === "INSTRUCTION_CREATED");
const resolveVerificationTask = (batchId) => resolveNotification(bankFileVerificationTaskKey(batchId));

// What the system can check on its own. Each problem names its code (translated in the UI), the
// request it concerns and an English message.
export async function bankFileProblems(batch) {
  const problems = [];
  try {
    const content = await readAsset(batch.filePath);
    if (crypto.createHash("sha256").update(content).digest("hex") !== batch.checksum) problems.push({ code: "FILE_CHANGED", message: "The TXT no longer matches the file that was generated." });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    problems.push({ code: "FILE_MISSING", message: "The TXT file was not found in storage." });
  }
  // A payment removed from the file after generation is still a line of the TXT: the file must be
  // generated again without it.
  for (const item of batch.items || []) {
    if (item.status === "CANCELLED") problems.push({ code: "ITEM_REMOVED", requestNumber: item.requestNumber, message: `${item.requestNumber} was removed from this file after it was generated, but the TXT still contains it.` });
  }
  const items = activeItems(batch);
  if (!items.length) problems.push({ code: "NO_ACTIVE_PAYMENTS", message: "The file has no payment left to send." });
  if (!moneyEquals(sumMoney(batch.items.map((item) => item.amount)), batch.totalAmount)) problems.push({ code: "TOTAL_MISMATCH", message: "The file total does not match the sum of its payments." });
  const payables = await AccountsPayable.find({ _id: { $in: items.map((item) => item.accountsPayable) } });
  const byId = new Map(payables.map((ap) => [String(ap._id), ap]));
  for (const item of items) {
    const ap = byId.get(String(item.accountsPayable));
    const requestNumber = item.requestNumber;
    if (!ap || String(ap.paymentBatch || "") !== String(batch._id) || ![AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID].includes(ap.status)) {
      problems.push({ code: "PAYABLE_CHANGED", requestNumber, message: `${requestNumber}: the payable is no longer waiting in this file.` });
      continue;
    }
    if (!await bouncedDestinationStillVerified(ap)) problems.push({ code: "DESTINATION_NOT_VERIFIED", requestNumber, message: `${requestNumber}: the beneficiary account is no longer verified.` });
    try { await assertNoBlockingObservation(ap, { requestNumber }); } catch (error) {
      if (error.code !== ERROR_CODES.PAYABLE_BLOCKING_OBSERVATION) throw error;
      problems.push({ code: "BLOCKING_OBSERVATION", requestNumber, message: `${requestNumber}: the payable has an open observation.` });
    }
  }
  return problems;
}

// No status lists every file; a notification link (?record=) shows its file whatever its status.
function verificationQuery(status) {
  if (status === BANK_FILE_VERIFICATION.PENDING) return { status: "GENERATED", "verification.status": BANK_FILE_VERIFICATION.PENDING };
  if (status === BANK_FILE_VERIFICATION.REJECTED) return { "verification.status": BANK_FILE_VERIFICATION.REJECTED };
  // Files from before this control count as verified.
  if (status === BANK_FILE_VERIFICATION.VERIFIED) return { $or: [{ "verification.status": BANK_FILE_VERIFICATION.VERIFIED }, { "verification.status": { $exists: false } }] };
  return {};
}

export async function listBankFilesForVerification(queryParams = {}) {
  const query = queryParams.record ? {} : verificationQuery(String(queryParams.verificationStatus || "").toUpperCase());
  if (queryParams.currency) query.currency = queryParams.currency;
  if (queryParams.search) {
    const search = new RegExp(escapedRegex(queryParams.search), "i");
    query.$and = [...(query.$and || []), { $or: [{ batchNumber: search }, { fileName: search }, { "items.requestNumber": search }, { "items.supplierName": search }] }];
  }
  withDeepLink(query, queryParams, { record: "_id" });
  const { page, pageSize, skip } = parsePagination(queryParams);
  const sort = parseSort(queryParams, ["batchNumber", "currency", "totalAmount", "paymentDate", "generatedAt"], { paymentDate: 1, generatedAt: 1 });
  const [batches, total] = await Promise.all([
    PaymentBatch.find(query).populate("generatedBy verification.verifiedBy verification.rejectedBy", "name email role").sort(sort).skip(skip).limit(pageSize),
    PaymentBatch.countDocuments(query)
  ]);
  const now = new Date();
  return paginatedPayload(batches.map((batch) => ({ ...batch.toObject(), verificationStatus: bankFileVerificationStatus(batch), paymentDateWarning: paymentDateWarning(batch, now) })), total, page, pageSize);
}

async function pendingBatch(batchId) {
  const batch = await PaymentBatch.findById(batchId).select("+filePath");
  if (!batch) throw new AppError(404, "Bank file not found.", { batchId }, ERROR_CODES.NOT_FOUND);
  if (batch.status !== "GENERATED" || bankFileVerificationStatus(batch) !== BANK_FILE_VERIFICATION.PENDING) {
    throw new AppError(409, "This bank file is not waiting for verification.", { status: batch.status, verificationStatus: bankFileVerificationStatus(batch) }, ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  return batch;
}

// The automatic checks of one pending file, for the review screen before deciding.
export async function reviewBankFile(batchId) {
  const batch = await pendingBatch(batchId);
  return { batchId: batch._id, batchNumber: batch.batchNumber, problems: await bankFileProblems(batch), paymentDateWarning: paymentDateWarning(batch) };
}

export async function verifyBankFile({ batchId, user, req }) {
  const batch = await pendingBatch(batchId);
  // Separation of duties: whoever generated the file does not verify it. Admin may.
  if (String(batch.generatedBy) === String(user._id) && user.role !== ROLES.ADMIN) {
    throw new AppError(403, "You generated this bank file, so another person must verify it.", { batchId }, ERROR_CODES.FORBIDDEN);
  }
  const problems = await bankFileProblems(batch);
  if (problems.length) {
    throw new AppError(422, "The bank file did not pass its checks. Reject it so Treasury can correct and generate it again.", { batchId, problems }, ERROR_CODES.BANK_FILE_CHECKS_FAILED);
  }
  const warning = paymentDateWarning(batch);
  const verification = { status: BANK_FILE_VERIFICATION.VERIFIED, checksum: batch.checksum, verifiedBy: user._id, verifiedAt: new Date() };
  // Only the pending, unchanged file is released: a concurrent cancel or decision wins.
  const result = await PaymentBatch.updateOne({ _id: batch._id, status: "GENERATED", "verification.status": BANK_FILE_VERIFICATION.PENDING, checksum: batch.checksum }, { $set: { verification } });
  if (result.modifiedCount !== 1) throw new AppError(409, "The bank file changed while it was being verified. Refresh and try again.", { batchId }, ERROR_CODES.CONFLICT);
  await GeneratedFile.updateOne({ "metadata.batchId": batch._id }, { $set: { "metadata.verification": verification } });
  await recordAudit({ entityType: "PaymentBatch", entity: batch, action: "BANK_FILE_VERIFIED", user, req, module: "ACCOUNTING",
    message: "Accounting verified the bank file; Treasury may download it.",
    newValues: { batchNumber: batch.batchNumber, checksum: batch.checksum, totalAmount: batch.totalAmount, itemCount: activeItems(batch).length, ...(warning ? { paymentDateWarning: warning } : {}) } });
  await resolveVerificationTask(batch._id);
  await notifyRoles({
    roles: [ROLES.TREASURY],
    eventKey: `bank-file:${batch._id}:verified`,
    type: "BANK_FILE_VERIFIED",
    title: notificationText("Bank file verified"),
    message: notificationText("Accounting verified {batchNumber}. You can download it and send it to the bank.", { batchNumber: batch.batchNumber }),
    path: "/treasury/history",
    entityType: "PaymentBatch",
    entityId: batch._id
  });
  return { batch: await PaymentBatch.findById(batch._id).populate("generatedBy verification.verifiedBy", "name email role"), paymentDateWarning: warning };
}

// Rejecting cancels the file: its CXPs go back to Treasury's queue to be corrected and generated
// again, and the reason travels with them.
export async function rejectBankFile({ batchId, payload = {}, user, req }) {
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new AppError(422, "A rejection reason is required.", { field: "reason" }, ERROR_CODES.VALIDATION_ERROR);
  const batch = await pendingBatch(batchId);
  const verification = { status: BANK_FILE_VERIFICATION.REJECTED, rejectedBy: user._id, rejectedAt: new Date(), reason };
  const claimed = await PaymentBatch.updateOne({ _id: batch._id, status: "GENERATED", "verification.status": BANK_FILE_VERIFICATION.PENDING }, { $set: { verification } });
  if (claimed.modifiedCount !== 1) throw new AppError(409, "The bank file changed while it was being reviewed. Refresh and try again.", { batchId }, ERROR_CODES.CONFLICT);
  try {
    await cancelPaymentBatch({ batchId: batch._id, payload: { reason: `Rejected by Accounting: ${reason}` }, user, req });
  } catch (error) {
    // The file stays pending when it could not be cancelled, so nothing is left half-decided.
    await PaymentBatch.updateOne({ _id: batch._id, "verification.status": BANK_FILE_VERIFICATION.REJECTED }, { $set: { verification: { status: BANK_FILE_VERIFICATION.PENDING } } });
    throw error;
  }
  await GeneratedFile.updateOne({ "metadata.batchId": batch._id }, { $set: { "metadata.verification": verification } });
  await recordAudit({ entityType: "PaymentBatch", entity: batch, action: "BANK_FILE_REJECTED", user, req, module: "ACCOUNTING", comments: reason,
    message: "Accounting rejected the bank file; it was cancelled and its CXPs returned to Treasury.",
    newValues: { batchNumber: batch.batchNumber, reason, returnedPayables: activeItems(batch).map((item) => item.accountsPayable) } });
  await resolveVerificationTask(batch._id);
  await notifyRoles({
    roles: [ROLES.TREASURY],
    eventKey: `bank-file:${batch._id}:rejected`,
    type: "BANK_FILE_REJECTED",
    title: notificationText("Bank file rejected by Accounting"),
    message: notificationText("{batchNumber} was rejected and cancelled: {reason}. Its payments are back in the queue.", { batchNumber: batch.batchNumber, reason }),
    path: "/treasury?tab=prepare",
    entityType: "PaymentBatch",
    entityId: batch._id
  });
  return { batch: await PaymentBatch.findById(batch._id).populate("generatedBy verification.rejectedBy", "name email role") };
}
