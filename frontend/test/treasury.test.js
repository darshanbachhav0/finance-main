import assert from "node:assert/strict";
import fs from "node:fs";
import treasurySpanish from "../src/context/i18n/treasury.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/TreasuryQueue.jsx");

// Preparation uses inline review, one generation action and selection across filtered pages.
assert.match(page, /<PaymentBatchSummary summary=\{review\?\.summary\}/);
assert.match(page, /queueTable\.remote\.fetchAll\(5001\)/);
assert.doesNotMatch(page, /<ConfirmDialog open=\{confirmOpen\}/);
assert.match(page, /onClick=\{generate\}/);
assert.match(page, /idempotencyKey: generation\.current\.key/);

// Changing the currency asks before clearing the selection.
assert.match(page, /if \(selected\.length\) setPendingCurrency\(next\);/);
assert.match(page, /changeCurrency\(event\.target\.value\)/);
assert.doesNotMatch(page, /setCurrency\(event\.target\.value\); setSelected\(\[\]\)/);

// The stage is in the URL; the KPI cards open their stage.
assert.match(page, /if \(view === "prepare"\) next\.delete\("tab"\);\n\s*else next\.set\("tab", view\);/);
assert.match(page, /onChange=\{selectView\}/);

// Only what the page shows is loaded; Refresh follows the visible list.
assert.match(page, /const linkOptions = \{ fixedParams: linkParams, deepLink: linkActive, enabled: !historyOnly \};/);
assert.match(page, /usePaginatedResource\("\/treasury\/bank-files", \{ enabled: historyOnly \}\)/);
assert.match(page, /const loading = historyOnly \? historyTable\.loading : stageTables\[paymentView\]\.loading;/);

// Cancelling a bank file uses the shared confirm dialog with a required reason.
assert.doesNotMatch(page, /cancel-bank-file-form|cancelReason/);
assert.match(page, /title=\{cancelTarget\?\.accountsPayableId \? "Remove from bank file\?" : "Cancel bank file\?"\}[^\n]*inputRequired[^\n]*onConfirm=\{cancelFile\}/);

// Form details: dates are formatted, hints follow their input, SPOT deposits are whole soles.
assert.match(page, /Scheduled payment date/);
assert.match(page, /statementAmount: event\.target\.value \}\)\} \/><small className="field-hint">/);
assert.match(page, /SPOT deposits are rounded to the sol/);
for (const text of ["File details", "Select payments", "Review and generate", "Change the file currency?", "Bank TXT instruction created. Payment remains unconfirmed."]) assert.ok(treasurySpanish[text], `Spanish for "${text}"`);
assert.match(page, /import "\.\.\/styles\/treasury\.css";/);

// A payment that cannot be selected says why, in plain words, and links to the supplier's bank
// accounts where it is fixed. Every reason has Spanish.
{
  const { PAYMENT_BLOCK_TEXT, paymentBlockFor } = await import("../src/utils/paymentBlock.js");
  const row = (paymentBlock, patch = {}) => ({ supplier: { _id: "s1", legalName: "VM PUBLICIDAD & INVERSION E.I.R.L." }, accountsPayable: { currency: "PEN" }, eligibleBankAccounts: [], paymentBlock, ...patch });
  const pending = paymentBlockFor(row({ code: "PENDING_VERIFICATION", currency: "PEN" }), "PEN");
  assert.deepEqual(pending, { code: "PENDING_VERIFICATION", params: { currency: "PEN", others: "" }, href: "/suppliers/s1#supplier-section-banking-information" });
  assert.equal(paymentBlockFor(row({ code: "OTHER_CURRENCY", currency: "PEN", others: "USD" }), "PEN").params.others, "USD");
  assert.equal(paymentBlockFor(row({ code: "NO_EMPLOYEE_ACCOUNT", currency: "PEN" }, { supplier: null }), "PEN").href, undefined, "an employee's account is not in a supplier record");
  assert.deepEqual(paymentBlockFor(row(null, { accountsPayable: { currency: "USD" } }), "PEN"), { code: "FILE_CURRENCY", params: { currency: "USD" } }, "a USD payment in a PEN file");
  assert.equal(paymentBlockFor(row(null), "PEN"), null, "no reason known: the generic warning only");
  assert.equal(paymentBlockFor(row({ code: "SOMETHING_NEW" }), "PEN"), null);
  for (const text of [...Object.values(PAYMENT_BLOCK_TEXT), "Open the supplier's bank accounts"]) assert.ok(treasurySpanish[text], `Spanish for "${text}"`);
  for (const [code, text] of Object.entries(PAYMENT_BLOCK_TEXT)) {
    const placeholders = (value) => (value.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(placeholders(treasurySpanish[text]), placeholders(text), `${code}: the Spanish keeps the placeholders`);
  }
  const cell = page.slice(page.indexOf("if (!accounts.length) {"), page.indexOf("if (locked) {"));
  assert.match(cell, /const block = paymentBlockFor\(row, currency\);/);
  assert.match(cell, /t\(PAYMENT_BLOCK_TEXT\[block\.code\]\)/);
  assert.match(cell, /<Link to=\{block\.href\} onClick=\{\(event\) => event\.stopPropagation\(\)\}>\{t\("Open the supplier's bank accounts"\)\}<\/Link>/);
  assert.match(read("../src/pages/Suppliers.jsx"), /document\.getElementById\(location\.hash\.slice\(1\)\)\?\.scrollIntoView/, "the supplier record opens at the linked section");
  assert.match(read("../src/components/suppliers/SupplierDetail.jsx"), /"Banking Information"/, "the section the link points to");
}

console.log("PASS treasury: three-step bank file, currency change confirmed, stage in the URL, lazy lists, shared cancel dialog, why a payment is blocked");
