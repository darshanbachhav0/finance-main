import assert from "node:assert/strict";
import fs from "node:fs";
import uxsearchSpanish from "../src/context/i18n/uxsearch.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const backend = (path) => read(`../../backend/src/${path}`);
const palette = read("../src/components/CommandPalette.jsx");
const service = backend("services/globalSearchService.js");

// 1. The palette searches records through the scoped endpoint: debounced, from 2 characters,
//    cancelled by the next keystroke, and never for ManagementViewer (refused by the API gate).
assert.match(palette, /api\.get\("\/search", \{ params: \{ q: trimmed \}, signal: controller\.signal \}\)/);
assert.match(palette, /const MIN_RECORD_QUERY = 2;/);
assert.match(service, /export const SEARCH_MIN_LENGTH = 2;/, "client and server share the minimum length");
assert.match(palette, /window\.setTimeout\(async \(\) => \{[\s\S]*?\}, SEARCH_DEBOUNCE_MS\)/);
assert.match(palette, /controller\.abort\(\)/);
assert.match(palette, /user\.role !== "ManagementViewer"/);
assert.doesNotMatch(palette, /api\.get\("\/requests"/, "record search no longer lists requests directly");

// 2. Every server group has a label, badge and icon; pages keep working as before.
const serverGroups = JSON.parse(service.match(/SEARCH_GROUPS = Object\.freeze\((\[[^\]]+\])\)/)[1]);
assert.deepEqual(serverGroups, ["requests", "suppliers", "vouchers", "payables", "users"]);
for (const type of serverGroups) assert.match(palette, new RegExp(`${type}: \\{ label: "[^"]+", typeLabel: "[^"]+", icon: \\w+ \\}`), type);
assert.match(palette, /kind: "page"/);
assert.match(palette, /\.slice\(0, 8\)/);

// 3. Keyboard, highlighting, loading and empty states.
for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) assert.ok(palette.includes(`"${key}"`), key);
assert.match(palette, /aria-activedescendant=/);
assert.match(palette, /role="group"/);
assert.match(palette, /<mark key=\{index\} className="command-match">/);
assert.match(palette, /escapeRegExp\(needle\)/, "the highlighted query is escaped too");
assert.match(palette, /scrollIntoView/);
for (const message of ["Searching records...", "No pages or records match your search.", "Type at least 2 characters to search records.", "Records could not be searched. Pages are still available.", "Search pages, requests, suppliers, invoices...", "Invoices and vouchers", "People", "Person", "Pages", "Page"]) {
  assert.ok(palette.includes(`"${message}"`), `${message} is used`);
  assert.ok(uxsearchSpanish[message], `${message} has Spanish copy`);
}

// 4. Every result opens the exact record through an existing route or deep link.
assert.match(service, /path: `\/requests\/\$\{row\._id\}`/);
assert.match(service, /path: `\/requests\/\$\{row\.parentRequest\._id\}`/, "a voucher opens its request");
assert.match(service, /path: `\/suppliers\?record=\$\{row\._id\}`/);
assert.match(service, /path: `\/accounting\/payables\?record=\$\{row\._id\}`/);
assert.match(read("../src/pages/Suppliers.jsx"), /searchParams\.get\("record"\)/);
assert.match(read("../src/pages/AccountsPayable.jsx"), /useDeepLink\(\["record", "request"\]\)/);
// People: the Users table has no ?record= link, so the palette pre-sets that table's saved search.
assert.match(service, /path: "\/users",\s*\n\s*filter:/);
assert.match(palette, /"erp_table_query:\/users"/);
assert.match(read("../src/hooks/usePaginatedResource.js"), /`erp_table_query:\$\{persistKey \|\| endpoint\}`/);
assert.match(read("../src/pages/AdminUsers.jsx"), /endpoint="\/users"/);

// 5. The endpoint sits behind the internal gate (ManagementViewer gets 403) and each group is
//    scoped with the list endpoints' own rules.
const routes = backend("routes/index.js");
assert.ok(routes.indexOf('router.use("/search", searchRoutes)') > routes.indexOf("router.use(protect, authorize("));
assert.match(service, /requestVisibilityFilter\(user\)/);
assert.match(service, /prefixFilter\(requestVisibilityFilter\(user\), "parentRequest"\)/);
assert.match(service, /canViewSuppliers\(user\.role\)/);
assert.match(service, /new RegExp\(escapedRegex\(query\), "i"\)/);

// 6. Styles live in the labelled block at the end of global.css.
const css = read("../src/styles/global.css");
const block = css.indexOf("/* ==== ux: global search ==== */");
assert.ok(block > css.indexOf("/* ==== design system (final layer)"));
for (const selector of [".command-group-label", ".command-result-type", ".command-match", ".command-status"]) assert.ok(css.indexOf(selector, block) > block, selector);

console.log("PASS global search: scoped grouped records, deep links, keyboard, highlighting and states");
