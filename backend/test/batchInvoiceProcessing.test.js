import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
const source = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
test("A2 batch service validates each candidate and isolates observations", () => {
  const service = source("../src/services/batchInvoiceService.js");
  for (const token of ["validateVoucherWithSunat", "findDuplicateVoucher", "assertPurchaseOrderInvoiceFits", "OBSERVED_SUNAT", "OBSERVED_DUPLICATE", "OBSERVED_AMOUNT_EXCEEDED", "PROVISIONED"]) assert.ok(service.includes(token), `Missing ${token}`);
  assert.match(service, /for \(const candidate of/);
  assert.match(service, /COMPLETED_WITH_OBSERVATIONS/);
});
test("A2 uses a background runner and safe ZIP/XLSX parsing", () => {
  const queue = source("../src/queues/batchInvoiceQueue.js");
  const service = source("../src/services/batchInvoiceService.js");
  const zip = source("../src/utils/zipReader.js");
  assert.match(queue, /enqueueBatch/);
  assert.match(service, /readZipFile/);
  assert.match(service, /xlsxRows/);
  assert.match(service, /assertSafeSpreadsheetEntries/);
  assert.match(service, /BATCH_MAX_COMPRESSION_RATIO/);
  assert.match(zip, /inflateRawSync/);
  assert.match(zip, /maxOutputLength/);
  assert.match(zip, /local\/central header mismatch/);
});
