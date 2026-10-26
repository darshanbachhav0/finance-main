import assert from "node:assert/strict";
import fs from "node:fs";
import supplierSunatSpanish from "../src/context/i18n/supplierSunat.js";
import { AUTOMATIC_TAXPAYER_VARIANTS, automaticTaxpayerLookup } from "../src/utils/sunatSource.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// 1. SUNAT Consulta RUC (the default) verifies a supplier by itself, like the Padrón.
assert.deepEqual([...AUTOMATIC_TAXPAYER_VARIANTS], ["CONSULTA_RUC", "PADRON"]);
assert.equal(automaticTaxpayerLookup({ variant: "CONSULTA_RUC" }), true);
assert.equal(automaticTaxpayerLookup({ mode: "MANUAL" }), false);
const detail = read("../src/components/suppliers/SupplierDetail.jsx");
assert.doesNotMatch(detail, /variant === "PADRON"/, "the automatic validation action is not Padrón-only");
assert.equal((detail.match(/automaticTaxpayerLookup\(provider\)/g) || []).length, 2, "validate and revalidate");

// 2. The evidence shows the rest of the Consulta RUC profile, only what SUNAT reported.
const evidence = read("../src/components/suppliers/SupplierSunatEvidence.jsx");
for (const field of ["taxpayerType", "economicActivities", "voucherIssuanceSystem", "accountingSystem", "foreignTradeActivity", "electronicIssuerSince", "electronicVouchers", "electronicIssuanceSystems", "printedVoucherTypes", "pleAffiliationDate", "registries"]) {
  assert.ok(evidence.includes(`data.${field}`), `evidence shows ${field}`);
}
assert.match(evidence, /\.filter\(\(\[, value\]\) => \(Array\.isArray\(value\) \? value\.length : value\)\)/, "absent fields are not shown");
assert.equal(supplierSunatSpanish["SUNAT taxpayer profile"], "Ficha RUC SUNAT");
assert.equal(supplierSunatSpanish["Economic activities"], "Actividades económicas");

// 3. Accounting is told that Consulta RUC never verifies an individual invoice.
assert.match(read("../src/pages/AccountingEntries.jsx"), /sunat\?\.variant === "CONSULTA_RUC" && .*Consulta RUC mode/);

console.log("PASS Consulta RUC: automatic validation, full SUNAT profile shown, Accounting told invoices still need the manual exception");
