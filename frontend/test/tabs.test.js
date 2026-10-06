import assert from "node:assert/strict";
import fs from "node:fs";

// Line endings are normalized: a Windows checkout (core.autocrlf) has CRLF files.
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// One accessible tab bar (components/Tabs.jsx) replaces the hand-built aria-pressed button rows.
const tabs = read("../src/components/Tabs.jsx");
assert.match(tabs, /role="tablist"/);
assert.match(tabs, /role="tab"/);
assert.match(tabs, /aria-selected=\{selected\}/);
assert.match(tabs, /tabIndex=\{selected \? 0 : -1\}/, "only the selected tab is in the Tab order");
for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(tabs.includes(key), `${key} moves between tabs`);
assert.match(tabs, /className="tab-count"/, "tabs can show a count");

for (const page of ["AccountingEntries", "BudgetControl", "Operations", "RequestDetail", "TreasuryQueue"]) {
  const source = read(`../src/pages/${page}.jsx`);
  assert.match(source, /<Tabs /, `${page} uses the shared tabs`);
  assert.doesNotMatch(source, /<nav className="focus-tabs"/, `${page} has no hand-built tab row`);
}
// Panels are linked to their tabs where each tab has one panel.
for (const page of ["AccountingEntries", "BudgetControl", "TreasuryQueue"]) assert.match(read(`../src/pages/${page}.jsx`), /\{\.\.\.tabPanelProps\("/, `${page} panels are labelled by their tab`);
assert.match(read("../src/pages/TreasuryQueue.jsx"), /count: stageTotals\[PAYMENT_VIEWS\.indexOf\(id\)\]/, "Treasury stages show their counts");

console.log("PASS shared tabs: ARIA tab semantics, keyboard navigation, counts, adopted on every tabbed page");
