import Counter from "../models/Counter.js";
import { calendarDateKey, limaToday } from "../../../shared/businessCalendar.mjs";

// Every number comes from one atomic $inc on the counter document, so two people saving at the
// same moment never get the same number, and a number is never handed out twice (a deleted or
// voided record keeps its number; nothing is reused). The first number of a year creates the
// counter: when two first saves race, one insert loses on the unique {key, year} index and is
// simply retried as an increment.
export async function nextSequence(key, year = Number(limaToday().slice(0, 4)), { session } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { key, year },
        { $inc: { sequence: 1 }, $setOnInsert: { key, year } },
        { upsert: true, new: true, setDefaultsOnInsert: true, session }
      );
      return counter.sequence;
    } catch (error) {
      // Inside a transaction the failed write aborts it, so the caller retries the whole operation.
      if (error?.code !== 11000 || session || attempt >= 3) throw error;
    }
  }
}

// Raises a counter to at least `value` (never lowers it): used when numbers were assigned outside
// the counter (imports, migrations), so the next number continues after the highest one in use.
export async function ensureSequenceAtLeast(key, year, value, { session } = {}) {
  if (!(Number(value) > 0)) return;
  await Counter.updateOne({ key, year }, { $max: { sequence: Number(value) }, $setOnInsert: { key, year } }, { upsert: true, session });
}

export async function nextReference(prefix, key, date = new Date(), options = {}) {
  const year = Number((calendarDateKey(date) || limaToday()).slice(0, 4));
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
// Generated files (bank TXT, SIRE, consolidation and management exports): DOC-YYYY-#####.
export const nextDocumentNumber = (date, options) => nextReference("DOC", "generated-document", date, options);
