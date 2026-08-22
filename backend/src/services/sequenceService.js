import Counter from "../models/Counter.js";

export async function nextSequence(key, year = new Date().getUTCFullYear(), { session } = {}) {
  const counter = await Counter.findOneAndUpdate(
    { key, year },
    { $inc: { sequence: 1 }, $setOnInsert: { key, year } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
  return counter.sequence;
}

export async function nextReference(prefix, key, date = new Date(), options = {}) {
  const normalizedDate = new Date(date);
  const year = Number.isNaN(normalizedDate.getTime()) ? new Date().getUTCFullYear() : normalizedDate.getUTCFullYear();
  const sequence = await nextSequence(key, year, options);
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

export async function nextGlobalReference(prefix, key, width = 4, options = {}) {
  const sequence = await nextSequence(key, 0, options);
  return `${prefix}-${String(sequence).padStart(width, "0")}`;
}

export const nextRequestNumber = (date, options) => nextReference("SOL", "financial-request", date, options);
export const nextPurchaseOrderNumber = (date, options) => nextReference("OC", "purchase-order", date, options);
export const nextJournalNumber = (date, options) => nextReference("ASI", "journal-entry", date, options);
export const nextPaymentBatchNumber = (date, options) => nextReference("LOT", "payment-batch", date, options);
export const nextMassUploadBatchNumber = (date, options) => nextReference("CM", "mass-upload-batch", date, options);
export const nextSupplierCode = (options) => nextGlobalReference("PRV", "supplier", 4, options);
export const nextRenditionNumber = (date, options) => nextReference("RG", "rendition", date, options);
