const pending = new Set();
let runner = null;

function boolFromEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function inlineBatchProcessingEnabled() {
  return boolFromEnv(process.env.BATCH_INVOICE_INLINE_PROCESSING, process.env.NODE_ENV !== "production");
}

export function configureBatchInvoiceRunner(fn) {
  runner = fn;
}

export function enqueueBatch(batchId) {
  const id = String(batchId);
  // In production the durable Mongo-backed worker owns QUEUED jobs. The API only
  // starts an in-process job when explicitly configured (or in development/tests).
  if (!inlineBatchProcessingEnabled()) return false;
  if (pending.has(id)) return false;
  pending.add(id);
  setImmediate(async () => {
    try {
      if (runner) await runner(id);
    } catch (error) {
      console.error("Batch invoice processing failed", id, error);
    } finally {
      pending.delete(id);
    }
  });
  return true;
}

export function queuedBatchIds() {
  return [...pending];
}
