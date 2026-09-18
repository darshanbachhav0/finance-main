import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../src/pages/SireExport.jsx", import.meta.url), "utf8");

assert.ok(page.includes("response.data.validations"), "SIRE preview must display eligible and manual-review voucher records");
for (const field of [
  "supplierRuc",
  "supplierName",
  "documentType",
  "series",
  "number",
  "invoiceDate",
  "accountingDate",
  "fiscalPeriod",
  "currency",
  "subtotal",
  "igv",
  "total",
  "exchangeRate",
  "requestReference",
  "cxpReference",
  "fiscalValidationStatus",
  "exportStatus"
]) assert.ok(page.includes(field), `SIRE screen is missing ${field}`);
assert.ok(page.includes('options: ["PENDING", "EXPORTED", "MANUAL_REVIEW"]'));
assert.ok(page.includes("Only individually validated vouchers are included in the CSV"));

console.log("PASS SIRE/RCE frontend shows voucher, supplier, request, CXP, period, validation and export status");
