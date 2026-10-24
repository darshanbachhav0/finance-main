import assert from "node:assert/strict";
import fs from "node:fs";
import costCenterTypeSpanish from "../src/context/i18n/costCenterType.js";
import { validationFieldLabel } from "../src/utils/validationMessages.js";
import { beneficiaryNames, costCenterTypeLabels, isOnBehalf } from "../src/utils/costAllocation.js";
import { allocationPercentages, costAllocationProblems, splitByPercentages } from "../../shared/costCenterAllocation.mjs";

// Line endings are normalized: a Windows checkout (core.autocrlf) has CRLF files.
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/RequestCreate.jsx");
const editor = read("../src/components/CostAllocationEditor.jsx");

// 1. The request form asks for the Tipo de Centro de Costo with the amount: Propio by default,
//    Por Encargo for a supplier request only, and its fields appear only when it is chosen.
assert.match(page, /costCenterType: "PROPIO",/, "Propio is the default");
assert.match(page, /<Choice name="cost-center-type" value="PROPIO"/);
assert.match(page, /<Choice name="cost-center-type" value="POR_ENCARGO"/);
assert.match(page, /\{payee === "supplier" && <div className="field"><span>\{t\("Cost center type"\)\} \*<\/span>/, "Track C has no type: it stays Propio");
assert.match(page, /\{onBehalf && <CostAllocationEditor /, "progressive disclosure: the beneficiary only for Por Encargo");
assert.match(page, /\{!onBehalf && masters\.costCenters\.length > 1 && lines\.length > 1 && <details className="request-budget-adjustments"/, "the per-item CECO adjustment is Propio's");
assert.match(page, /const onBehalf = form\.flowType !== "C" && form\.costCenterType === "POR_ENCARGO";/);
assert.match(page, /api\.get\("\/requests\/beneficiary-cost-centers"\)/, "the schools and departments come from the CECO master");
// 2. The form applies the server's rules and sends ids and percentages only.
assert.match(page, /costAllocationProblems\(costAllocations\)/);
assert.match(page, /data\.append\("costAllocations", JSON\.stringify\(onBehalf \? costAllocations\.map\(\(\{ costCenter, percentage \}\) => \(\{ costCenter, percentage \}\)\) : \[\]\)\);/);
assert.match(page, /costCenterType: onBehalf \? "POR_ENCARGO" : "PROPIO",/);
assert.doesNotMatch(editor, /<input[^>]*name="costCenter"|type="text"/, "a CECO is chosen from the list, never typed");
assert.match(editor, /<SearchSelect label="School or department"/);
assert.match(editor, /Add another cost center/);

// 3. The request page, the approval page and the summary step show who bears the expense.
for (const file of ["../src/pages/RequestDetail.jsx", "../src/pages/ApprovalDecision.jsx", "../src/components/RequestReview.jsx"]) {
  assert.match(read(file), /<CostAllocationSummary allocations=/, `${file} shows the beneficiary CECOs`);
}
assert.match(read("../src/pages/ApprovalInbox.jsx"), /t\("On behalf of \{area\}"\)/);
const request = { costCenterType: "POR_ENCARGO", costAllocations: [{ costCenterSnapshot: { code: "MED", name: "Escuela de Medicina" }, percentage: 60 }, { costCenterSnapshot: { code: "ENF", name: "Escuela de Enfermería" }, percentage: 40 }] };
assert.equal(isOnBehalf(request), true);
assert.equal(isOnBehalf({ costCenterType: "PROPIO" }), false);
assert.equal(isOnBehalf({}), false, "requests from before the field are Propio");
assert.equal(beneficiaryNames(request), "Escuela de Medicina, Escuela de Enfermería");

// 4. The shares the form shows are the ones the server stores.
assert.deepEqual(splitByPercentages(10000, allocationPercentages([{ percentage: "60" }, { percentage: "30" }, { percentage: "10" }])), [6000, 3000, 1000]);
assert.deepEqual(allocationPercentages([{ percentage: "" }]), [100], "one beneficiary alone is 100%");
assert.deepEqual(costAllocationProblems([{ costCenter: "a".repeat(24), percentage: "60" }, { costCenter: "b".repeat(24), percentage: "30" }]).map((problem) => problem.field), ["costAllocations"]);
assert.equal(validationFieldLabel("costAllocations.1.percentage"), "Cost center 2 — Percentage");
assert.equal(validationFieldLabel("costAllocations"), "Cost center distribution");

// 5. Spanish, as the documentation names it.
assert.equal(costCenterTypeSpanish["Cost center type"], "Tipo de Centro de Costo");
assert.deepEqual(Object.values(costCenterTypeLabels).map((label) => costCenterTypeSpanish[label]), ["Propio", "Por encargo"]);
assert.equal(costCenterTypeSpanish["The distribution must add up to 100%."], "La distribución debe sumar 100%.");

console.log("PASS cost center type: Propio by default, Por Encargo from the CECO master, shares to 100%, shown on request, approval and summary");
