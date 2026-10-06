import assert from "node:assert/strict";
import fs from "node:fs";

// Line endings are normalized: a Windows checkout (core.autocrlf) has CRLF files.
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/RequestCreate.jsx");
const stepBody = (id) => {
  const start = page.indexOf(`{stepId === "${id}" && <div className="wizard-step`);
  assert.ok(start >= 0, `step ${id} renders`);
  return page.slice(start, page.indexOf("\n        {stepId === ", start + 10) > 0 ? page.indexOf("\n        {stepId === ", start + 10) : page.indexOf("</MotionSurface>", start));
};

// Steps: the old first step is split in two; Track C (paid to the requester) skips Supplier.
assert.match(page, /const stepsFor = \(flowType\) => flowType === "C" \? \["need", "budget", "documents", "review"\] : \["need", "budget", "supplier", "documents", "review"\];/);
assert.match(page, /const LEGACY_STEPS = \["need", "supplier", "documents", "review"\];/, "drafts saved before the split still restore");
assert.match(stepBody("need"), /blockInfo\.need[\s\S]*blockInfo\.why/);
assert.doesNotMatch(stepBody("need"), /blockInfo\.budget|blockInfo\.items/);
assert.match(stepBody("budget"), /blockInfo\.budget[\s\S]*blockInfo\.items[\s\S]*<BudgetRemainingSummary /, "the budget check sits next to the amounts");
assert.doesNotMatch(stepBody("supplier"), /BudgetRemainingSummary/);

// One set of rules: Continue checks what Submit checks.
assert.match(page, /function nextStep\(\) \{\n\s*const nextErrors = validationForStep\(stepId, true\);/);
assert.match(page, /goToStep\(checkedSteps\[firstInvalid\]\);\n\s*showProblems\(validations\[firstInvalid\]\);/, "Submit opens the step with the first problem and focuses it");

// Supplier step: one "supplier not found" link; quotations offer only eligible suppliers.
assert.equal(page.match(/Supplier not found\? Open the official supplier proposal flow/g).length, 1);
assert.match(page, /<SearchSelect label="Supplier" value=\{quotation\.supplier\} options=\{eligibleSuppliers\}/);
assert.match(page, /aria-label=\{t\("Remove quotation"\)\}/);

// Removed: the invoice XML preview (no invoice exists yet) and the legacy localStorage autosave.
assert.doesNotMatch(page, /InvoiceXmlPreview/);
assert.doesNotMatch(page, /localStorage/);

// Review: the readiness check runs only on the last step, open; the summary covers every step.
assert.match(page, /\{stepId === "review" && <ReadinessPanel defaultOpen payload=/);
const review = read("../src/components/RequestReview.jsx");
for (const label of ["Detailed description", "Expense nature", "Request month", "Expense frequency", "Project / PEP", "NPV / VAN amount", "Payback", "Recommended supplier", "Supporting documents"]) assert.ok(review.includes(`"${label}"`), `review shows ${label}`);
assert.match(review, /onEdit\(step\)/);

// Block badges no longer re-announce on every keystroke.
assert.doesNotMatch(read("../src/components/RequestFormBlock.jsx"), /aria-live/);

console.log("PASS request wizard: five steps (four for Track C), budget check beside amounts, one rule set, full review");
