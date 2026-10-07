import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { AppError } from "./AppError.js";
import { ERROR_CODES } from "./constants.js";

// Accounting verifies each generated bank TXT before Treasury may download it and send it to the
// bank. Kept free of service imports so Treasury, file access and the verification service can all
// read it.
export const BANK_FILE_VERIFICATION = Object.freeze({ PENDING: "PENDING", VERIFIED: "VERIFIED", REJECTED: "REJECTED" });

// Accounting's task for one file, opened at generation and closed by its decision or cancellation.
export const bankFileVerificationTaskKey = (batchId) => `bank-file:${batchId}:verification`;

// A batch generated before this control has no verification status: it counts as verified.
export function bankFileVerificationStatus(batch) {
  return batch?.verification?.status || BANK_FILE_VERIFICATION.VERIFIED;
}

export const isBankFileReleased = (batch) => bankFileVerificationStatus(batch) === BANK_FILE_VERIFICATION.VERIFIED;

// Treasury neither sends nor settles a file Accounting has not released.
export function assertBankFileReleased(batch, action = "use") {
  const status = bankFileVerificationStatus(batch);
  if (status === BANK_FILE_VERIFICATION.VERIFIED) return;
  const message = status === BANK_FILE_VERIFICATION.REJECTED
    ? `Accounting rejected bank file ${batch.batchNumber}; it cannot be used.`
    : `Bank file ${batch.batchNumber} is waiting for Accounting verification; you can ${action} it once it is verified.`;
  throw new AppError(409, message, { batchId: batch._id, batchNumber: batch.batchNumber, verificationStatus: status }, ERROR_CODES.BANK_FILE_NOT_VERIFIED);
}

// The system only warns, never blocks, when a file still waiting for Accounting reaches or passes
// its payment date: "TODAY" or "PASSED", otherwise null.
export function paymentDateWarning(batch, now = new Date()) {
  if (bankFileVerificationStatus(batch) !== BANK_FILE_VERIFICATION.PENDING || !batch?.paymentDate) return null;
  const paymentDay = limaDateKey(batch.paymentDate);
  const today = limaDateKey(now);
  if (paymentDay < today) return "PASSED";
  return paymentDay === today ? "TODAY" : null;
}
