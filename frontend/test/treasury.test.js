import assert from "node:assert/strict";
import fs from "node:fs";
import treasurySpanish from "../src/context/i18n/treasury.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/TreasuryQueue.jsx");

// Bank-file preparation in three numbered steps; the review sits next to Generate.
assert.match(page, /\[\["File details", fileDetailsReady\], \["Select payments", selected\.length > 0\], \["Review and generate", /);
assert.match(page, /const currentFileStep = !fileDetailsReady \? 0 : !selected\.length \? 1 : 2;/);
const review = page.slice(page.indexOf('<div className="bank-file-review"'), page.indexOf("</div>}", page.indexOf('<div className="bank-file-review"')));
assert.match(review, /<ReadinessPanel paymentPayload=\{\{ payableIds: selected, currency, accountSelections \}\} defaultOpen \/>/, "readiness is checked in step 3, not pushed above the page");
// Generate is in the sticky bar, a sibling of the list, so it stays in reach while choosing rows.
const bar = page.slice(page.indexOf('<div className="bulk-bar bank-file-bar"'));
assert.ok(page.indexOf('<div className="bulk-bar bank-file-bar"') > page.indexOf('<div className="bank-file-review"'));
assert.match(bar.slice(0, bar.indexOf("</div>}")), /setConfirmOpen\(true\)/);
assert.equal((page.match(/<ReadinessPanel /g) || []).length, 1);

// Changing the currency asks before clearing the selection.
assert.match(page, /if \(selected\.length\) setPendingCurrency\(next\);/);
assert.match(page, /onChange=\{\(event\) => changeCurrency\(event\.target\.value\)\}/);
assert.doesNotMatch(page, /setCurrency\(event\.target\.value\); setSelected\(\[\]\)/);

// The stage is in the URL; the KPI cards open their stage.
assert.match(page, /if \(view === "prepare"\) next\.delete\("tab"\);\n\s*else next\.set\("tab", view\);/);
assert.match(page, /onChange=\{selectView\}/);
for (const tab of ["prepare", "confirm", "returned"]) assert.match(page, new RegExp(`to="/treasury\\?tab=${tab}"`), `KPI opens ${tab}`);

// Only what the page shows is loaded; Refresh follows the visible list.
assert.match(page, /const linkOptions = \{ fixedParams: linkParams, deepLink: linkActive, enabled: !historyOnly \};/);
assert.match(page, /usePaginatedResource\("\/treasury\/bank-files", \{ enabled: historyOnly \}\)/);
assert.match(page, /const loading = historyOnly \? historyTable\.loading : stageTables\[paymentView\]\.loading;/);

// Cancelling a bank file uses the shared confirm dialog with a required reason.
assert.doesNotMatch(page, /cancel-bank-file-form|cancelReason/);
assert.match(page, /title=\{cancelTarget\?\.accountsPayableId \? "Remove from bank file\?" : "Cancel bank file\?"\}[^\n]*inputRequired[^\n]*onConfirm=\{cancelFile\}/);

// Form details: dates are formatted, hints follow their input, SPOT deposits are whole soles.
assert.match(page, /\{ label: "Payment date", value: formatDate\(/);
assert.match(page, /statementAmount: event\.target\.value \}\)\} \/><small className="field-hint">/);
assert.match(page, /SPOT deposits are rounded to the sol/);
for (const text of ["File details", "Select payments", "Review and generate", "Change the file currency?", "Bank TXT instruction created. Payment remains unconfirmed."]) assert.ok(treasurySpanish[text], `Spanish for "${text}"`);
assert.match(page, /import "\.\.\/styles\/treasury\.css";/);

console.log("PASS treasury: three-step bank file, currency change confirmed, stage in the URL, lazy lists, shared cancel dialog");
