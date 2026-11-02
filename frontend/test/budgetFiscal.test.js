import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exchangeRateDescription } from "../src/utils/financialEvidence.js";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
assert.match(exchangeRateDescription(undefined, "BCRP", 3.2, "2021-01-04"), /Historical evidence/);
assert.match(exchangeRateDescription({ source: "SUNAT", authoritative: true, rate: 3.75, date: "2026-09-11", fallback: { used: true, reason: "PREVIOUS_PUBLISHED_BUSINESS_DAY", requestedDate: "2026-09-13" } }), /Official SUNAT.*2026-09-13/);
assert.match(exchangeRateDescription({ source: "BCRP", authoritative: false, rate: 3.75, date: "2026-09-11" }), /not authoritative/);
assert.match(exchangeRateDescription({ source: "PEN", providerMode: "PEN", authoritative: true, rate: 1 }), /no conversion/);
const detail = read("../src/components/FinancialValidationSummary.jsx");
for (const text of ["Supplier / RUC validation", "Invoice validation", "Budget availability", "budgetExceptions", "exchangeRateEvidence"]) assert.ok(detail.includes(text));
const budget = read("../src/pages/BudgetControl.jsx");
// Gerencia General approves reviewed exceptions; Tesorería (which took over the Budget role) reviews them.
assert.match(budget, /canApprove = hasRole\(user, ROLES\.MANAGEMENT\)/);
assert.match(budget, /canDecide = hasRole\(user, ROLES\.TREASURY\)/);
assert.match(budget, /canEditPlans = userCan\(user, PERMISSIONS\.BUDGET_MANAGE\)/);
assert.match(budget, /canDecideChanges = hasRole\(user, ROLES\.MANAGEMENT\)/);
assert.doesNotMatch(budget, /user\.role ===|\["Admin"[^\]]*\]\.includes\(user/, "no role literals: access comes from the catalog");
assert.ok(budget.includes('status: "REVIEWED"'));
assert.ok(budget.includes("row.preparedBy"));
// Official SBS rates come from the automatic synchronization: they are locked on the page, and a
// typed rate is only ever a manual reference.
const exchangeRatePage = read("../src/pages/ExchangeRates.jsx");
assert.ok(exchangeRatePage.includes("rowLocked={official}") && exchangeRatePage.includes('label: "Manual reference rate"'));
console.log("PASS budget/fiscal UI: distinct validations, source/date/authority/fallback, historical evidence, Management approval and Budget review");
