import assert from "node:assert/strict";
import fs from "node:fs";
import { splitAnnualBudget } from "../../shared/budgetPlanning.mjs";
import { PERMISSIONS, userCan } from "../src/utils/access.js";
import { nextStepFor } from "../src/utils/nextStep.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// 1. Whoever holds budget.manage (Tesorería, which took over the Budget role) creates a CECO's
//    annual budget and spreads it over the months; the administrator does not.
const budget = source("../src/pages/BudgetControl.jsx");
assert.match(budget, /const canEditPlans = userCan\(user, PERMISSIONS\.BUDGET_MANAGE\);/);
assert.equal(userCan({ role: "Treasury" }, PERMISSIONS.BUDGET_MANAGE), true);
for (const role of ["Admin", "SuperAdmin", "Accounting", "GAF", "Management", "Auditor"]) assert.equal(userCan({ role }, PERMISSIONS.BUDGET_MANAGE), false, `${role} does not edit budget plans`);
assert.match(budget, /canManage=\{canEditPlans\} canEdit=\{canEditPlans\}/);
assert.match(budget, /\{ key: "area", label: "Area"/, "the budget table shows each CECO's area");
assert.match(budget, /\{canDecide && <>[\s\S]*?<\/>\}<button type="button" className="primary-button" onClick=\{\(\) => setWorkspace\(\{ planId: null \}\)\}>\{t\("Create annual budget"\)\}/, "carry-over and imports stay with Treasury; creating a budget is for budget.manage");

// 2. Equal or unequal months: two split buttons, or typed amounts.
const workspace = source("../src/components/BudgetPlanWorkspace.jsx");
assert.match(workspace, /splitAnnualBudget\(Number\(plan\.assignedAmount\)\.toFixed\(2\), \{ floors: plan\.months\.map\(\(bucket\) => usedIn\(bucket\) \/ 100\), fromMonth \}\)/);
assert.match(workspace, /onClick=\{\(\) => splitGrid\(1\)\}>\{t\("Split equally across the 12 months"\)\}/);
assert.match(workspace, /splitFrom > 1 && <button[^>]*onClick=\{\(\) => splitGrid\(splitFrom\)\}/);
assert.match(workspace, /plan\.costCenter\?\.area/, "the plan heading names the area");
assert.match(workspace, /priorUnplannedAmount/, "spending before the plan is pointed out");
assert.deepEqual(splitAnnualBudget("120000", { floors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 21000] }).slice(8), [9000, 21000, 9000, 9000], "a month that used more keeps it; the others share the rest");

// 3. The request form says the request is charged to the requester's own CECO.
const create = source("../src/pages/RequestCreate.jsx");
assert.match(create, /const ownCostCenter = masters\.costCenters\.find\(\(item\) => item\._id === idOf\(user\.costCenter\)\);/);
assert.match(create, /<small className="field-hint">\{ownCostCenterHint\}<\/small>/);

// 4. A rendition waiting for the budget: Treasury reviews the exception, Accounting approves again.
const waiting = { _id: "r1", flowType: "C", requestType: "ENTREGA_RENDIR", status: "PAGADO", requester: { _id: "u1", name: "Camila" }, observation: { code: "INSUFFICIENT_BUDGET" }, rendition: { status: "SUBMITTED", financeReview: { result: "PENDING" } } };
const treasury = nextStepFor({ request: waiting, user: { _id: "t", role: "Treasury" } });
assert.equal(treasury.key, "renditionBudget");
assert.equal(treasury.action.href, "/budget?tab=exceptions&exceptionStatus=PENDING");
const accounting = nextStepFor({ request: waiting, user: { _id: "a", role: "Accounting" } });
assert.equal(accounting.review, true, "Accounting can still approve from the card");
assert.match(accounting.text, /Once Management approves the budget exception, approve it again/);
assert.equal(nextStepFor({ request: { ...waiting, observation: {} }, user: { _id: "t", role: "Treasury" } }), null, "no budget step without the observation");

console.log("PASS CECO budgets: budget.manage edits plans, equal or custom months, area, own CECO, rendition budget step");
