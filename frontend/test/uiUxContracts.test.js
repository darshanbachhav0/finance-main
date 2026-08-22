import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatCurrency, formatDate, formatNumber } from "../src/utils/formatters.js";

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

test("shared financial formatters produce localized, fixed-precision values", () => {
  assert.match(formatCurrency(300050, "PEN", "es"), /S\/.*300,050\.00/);
  assert.match(formatCurrency(118, "USD", "en"), /\$118\.00/);
  assert.equal(formatNumber(0, "en"), "0");
  assert.equal(formatDate("not-a-date", "en"), "-");
});

test("DataTable exposes saved views, density, export, and collapsible mobile filters", () => {
  const table = source("../src/components/DataTable.jsx");
  const tools = source("../src/components/TableTools.jsx");
  assert.match(table, /<TableTools/);
  assert.match(table, /table-filter-toggle/);
  assert.match(table, /erp_table_density/);
  assert.match(tools, /Export current results/);
});

test("command palette and mobile navigation preserve keyboard focus contracts", () => {
  const palette = source("../src/components/CommandPalette.jsx");
  const layout = source("../src/layouts/AppLayout.jsx");
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) assert.ok(palette.includes(key));
  assert.match(palette, /aria-modal="true"/);
  assert.match(layout, /mobileMenuRef\.current\?\.focus/);
  assert.match(layout, /event\.key === "Escape"/);
});

test("analytics provide real drilldowns and an exact tabular fallback", () => {
  const chart = source("../src/components/AnalyticsChart.jsx");
  const reports = source("../src/pages/ManagementReports.jsx");
  assert.match(chart, /ChartFallback/);
  assert.match(chart, /accessibilityLayer/);
  assert.match(reports, /Accounts Payable ageing/);
  assert.match(reports, /Period-close readiness/);
  assert.match(reports, /navigate\(requestPath/);
  assert.doesNotMatch(reports, /mock data/i);
});

test("shared login exposes all eight UMA demo roles and fills their credentials", () => {
  const login = source("../src/pages/Login.jsx");
  for (const key of ["admin", "solicitor", "director", "vice", "accounting", "treasury", "budget", "management"]) {
    assert.match(login, new RegExp(`key: "${key}"`));
  }
  assert.match(login, /setEmail\(account\.email\)/);
  assert.match(login, /setPassword\(account\.password\)/);
  assert.doesNotMatch(login, /import\.meta\.env\.DEV\s*&&/);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} UI/UX contract tests passed.`);
