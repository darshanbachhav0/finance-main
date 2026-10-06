import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COLUMN_TYPES, columnLayout, isPrimaryColumn } from "../src/utils/tableColumns.js";
import uxlistsSpanish from "../src/context/i18n/uxlists.js";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];
const test = (name, callback) => tests.push({ name, callback });

const table = source("../src/components/DataTable.jsx");
const css = source("../src/styles/global.css");
const block = css.slice(css.indexOf("/* ==== ux: lists"));

test("row details open in an accessible side panel instead of an inline disclosure", () => {
  assert.doesNotMatch(table, /className="row-details"/, "the per-row <details> disclosure is gone");
  assert.match(table, /import Drawer from "\.\/Drawer\.jsx"/);
  assert.match(table, /<Drawer\s+open=\{Boolean\(detailRecord\)\}/);
  assert.match(table, /className="row-details-button" aria-haspopup="dialog"/);
  assert.match(table, /secondaryColumns\.map\(\(column\) => \{\s*const value = cellValue\(column, detailRecord\)/, "the panel lists every secondary field");
  // Rows open the panel on click unless the page opens its own quick view; controls inside do not.
  assert.match(table, /const openRow = onRowClick \|\| \(secondaryColumns\.length \? setDetailRow : null\)/);
  assert.match(table, /INTERACTIVE_TARGET = "a, button, input, select, textarea, details, label/);
  // The drawer closes on Escape, traps Tab and gives focus back to the element that opened it.
  const drawer = source("../src/components/Drawer.jsx");
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(drawer, /previousFocusRef\.current\?\.focus/);
  // Approvers preview a request from the inbox; the request list opens the record itself and
  // keeps the preview in the row menu (one "view" action, not two).
  assert.match(source("../src/pages/ApprovalInbox.jsx"), /onRowClick=\{\(row\) => setQuickViewId\(row\._id\)\}/);
  const requestsList = source("../src/pages/RequestsList.jsx");
  assert.match(requestsList, /onRowClick=\{\(row\) => navigate\(`\/requests\/\$\{row\._id\}`\)\}/);
  assert.match(requestsList, /label: "Quick view"/);
  assert.doesNotMatch(requestsList, /label: "Open full details"/);
  // The bulk-actions selection API is unchanged.
  assert.match(table, /selection\.onChange\(next\)/);
  assert.match(table, /selection\.isRowSelectable/);
});

test("related tools are visible shortcut chips under the page header", () => {
  const tools = source("../src/components/WorkspaceTools.jsx");
  assert.doesNotMatch(tools, /<details/);
  assert.match(tools, /<nav className="workspace-shortcuts" aria-label=\{t\("Related tools"\)\}>/);
  assert.match(tools, /className="shortcut-chip"/);
  for (const page of ["RequestsList", "TreasuryQueue", "AccountingEntries", "BudgetControl"]) {
    const text = source(`../src/pages/${page}.jsx`);
    assert.ok(text.indexOf("<WorkspaceTools") > text.indexOf("<PageHeader"), `${page}: chips follow the page header`);
  }
  assert.match(block, /\.workspace-shortcuts ul \{[^}]*flex-wrap: wrap/);
  assert.doesNotMatch(source("../src/pages/MasterConfiguration.jsx"), /<summary>\{t\("Configuration sections"\)\}/, "section navigation is not hidden");
});

test("column types size columns to their content", () => {
  assert.deepEqual(Object.keys(COLUMN_TYPES).sort(), ["checkbox", "code", "date", "money", "name", "number", "status", "text"]);
  assert.deepEqual(columnLayout({ key: "select", type: "checkbox" }), { type: "checkbox", align: undefined, className: "col-checkbox checkbox-column", style: { width: "44px" } });
  assert.deepEqual(columnLayout({ key: "total", type: "money" }), { type: "money", align: "right", className: "col-money align-right", style: { width: "1%" } });
  assert.deepEqual(columnLayout({ key: "legalName", type: "name", minWidth: "260px" }).style, { minWidth: "260px" });
  assert.deepEqual(columnLayout({ key: "code", type: "code", width: "110px" }).style, { width: "110px" }, "a column's own width wins");
  assert.equal(columnLayout({ key: "notes" }).className, undefined);
  assert.deepEqual(columnLayout({ key: "count", align: "right" }), { type: undefined, align: "right", className: "align-right", style: undefined }, "untyped columns keep their old layout");
  // Money and status stay in the row; `primary` decides explicitly.
  assert.equal(isPrimaryColumn({ key: "debit", type: "money" }, 6), true);
  assert.equal(isPrimaryColumn({ key: "financeReview", type: "status" }, 4), true);
  assert.equal(isPrimaryColumn({ key: "dueDate", type: "date" }, 9), false);
  assert.equal(isPrimaryColumn({ key: "dueDate", type: "date", primary: true }, 9), true);
  assert.equal(isPrimaryColumn({ key: "supplier", primary: false }, 1), false);
  assert.match(table, /const layout = columnLayout\(column\);[\s\S]*className=\{layout\.className\} style=\{layout\.style\}/);
  // Main tables declare their column types. Treasury selects CXPs through DataTable's built-in
  // selection column, which the stylesheet keeps at 44px.
  const treasury = source("../src/pages/TreasuryQueue.jsx");
  assert.match(treasury, /selection=\{\{ selected, onChange: setSelected/);
  assert.match(source("../src/styles/global.css"), /\.table-scroll th\.checkbox-column \{ width: 44px/);
  for (const [page, count] of [["RequestsList", 6], ["ApprovalInbox", 5], ["TreasuryQueue", 30], ["InvoiceObservations", 7], ["AccountingEntries", 20]]) {
    assert.ok((source(`../src/pages/${page}.jsx`).match(/type: "(code|money|status|name|date|checkbox|number)"/g) || []).length >= count, `${page} sets column types`);
  }
  for (const page of ["AccountsPayable", "Suppliers"]) assert.ok((source(`../src/pages/${page}.jsx`).match(/type:\s+"(code|money|status|name|date)"/g) || []).length >= 5, `${page} sets column types`);
  // CSS: equal-width fixed layout is gone, money never wraps, names wrap instead of truncating.
  assert.doesNotMatch(css, /\.table-scroll table \{ width: 100%; table-layout: fixed; \}/);
  assert.doesNotMatch(css, /\.table-scroll \.align-right \{ white-space: normal; \}|, \.table-scroll \.align-right \{ white-space: normal/);
  assert.match(block, /\.table-scroll td\.col-code, \.table-scroll td\.col-date, \.table-scroll td\.col-money, \.table-scroll td\.col-number \{ white-space: nowrap; \}/);
});

test("table headers stay pinned while a long list scrolls, in table mode only", () => {
  assert.ok(css.trimEnd().endsWith("}") && css.lastIndexOf("/* ==== ux: lists") > css.lastIndexOf("/* ==== design system (final layer)"), "the lists block is the last layer");
  const tableMode = block.slice(block.indexOf("@media screen and (min-width: 641px) {"));
  assert.match(tableMode, /^@media screen and \(min-width: 641px\) \{\s*@container \(min-width: 1051px\) \{/, "above the card-layout breakpoints (640px screen, 1050px container)");
  assert.match(tableMode, /\.data-table \.table-scroll \{ max-height: [^;]+; overflow: auto; \}/);
  assert.match(tableMode, /\.data-table \.table-scroll thead th \{ position: sticky; top: 0;[^}]*background: var\(--gray-50\)/);
  assert.match(block, /@media print \{[^}]*\.row-details-cell/);
});

test("lists share one loading and empty-state pattern that suggests the next action", () => {
  const skeleton = source("../src/components/WorkspaceSkeleton.jsx");
  assert.match(skeleton, /export function TableSkeletonRows/);
  assert.match(skeleton, /export function ListSkeleton/);
  assert.match(skeleton, /<div className="workspace-panel loading-panel"><ListSkeleton \/><\/div>/);
  assert.match(table, /loading \? <TableSkeletonRows/);
  assert.match(source("../src/components/BudgetPlanWorkspace.jsx"), /<ListSkeleton /);
  assert.doesNotMatch(source("../src/components/BudgetPlanWorkspace.jsx"), /<p role="status">\{t\("Loading\.\.\."\)\}<\/p>/);

  const empty = source("../src/components/EmptyState.jsx");
  assert.match(empty, /export default function EmptyState\(\{[^}]*action \}\)/);
  assert.match(empty, /onClear && <button[^>]*>.*\{t\("Clear filters"\)\}/);
  assert.match(empty, /!filtered && action && \(action\.to/);
  assert.match(table, /emptyAction,/);
  assert.match(table, /<EmptyState title=\{hasFilters \? "No matching results" : emptyTitle\} filtered=\{hasFilters\} onClear=\{hasFilters \? clearFilters : undefined\}[^>]*action=\{emptyAction\}/);

  assert.match(source("../src/pages/RequestsList.jsx"), /emptyAction=\{canCreate \? \{ label: "Create request", to: "\/requests\/new", icon: Plus \} : undefined\}/);
  assert.match(source("../src/pages/Suppliers.jsx"), /emptyAction=\{canPropose \? \{ label: "New supplier", onClick: startCreate, icon: Plus \} : undefined\}/);
  assert.match(source("../src/pages/InvoiceObservations.jsx"), /emptyAction=\{\{ label: "A2 Batch Invoices", to: "\/batch-invoices" \}\}/);
  assert.match(source("../src/pages/AccountsPayable.jsx"), /emptyAction=\{\{ label: "Accounting Entries", to: "\/accounting" \}\}/);
  assert.equal((source("../src/pages/TreasuryQueue.jsx").match(/emptyAction=\{\{/g) || []).length, 4);

  // Every new empty-state title and description has Spanish copy.
  const pages = ["RequestsList", "Suppliers", "InvoiceObservations", "AccountsPayable", "TreasuryQueue"].map((page) => source(`../src/pages/${page}.jsx`)).join("\n");
  const strings = [...pages.matchAll(/empty(?:Title|Description)=(?:\{canCreate \? |\{canPropose \? )?"([^"]+)"(?: : "([^"]+)")?/g)].flatMap((match) => [match[1], match[2]]).filter(Boolean);
  assert.ok(strings.length >= 14, `found ${strings.length} empty-state strings`);
  for (const text of strings) assert.ok(uxlistsSpanish[text], `Spanish copy for "${text}"`);
  assert.ok(uxlistsSpanish["Additional information for this record."]);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}
console.log(`${tests.length} UX list contract tests passed.`);
