import assert from "node:assert/strict";
import fs from "node:fs";
import suppliersSpanish from "../src/context/i18n/suppliers.js";
import { homologationChecklist, supplierStepProblems, supplierStepsFor } from "../src/utils/supplierProposal.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const form = read("../src/components/suppliers/SupplierForm.jsx");

// Steps: the bank step exists only where the form registers the first account (new proposals).
assert.deepEqual(supplierStepsFor({ includeInitialBank: true }), ["identity", "conditions", "bank", "compliance", "review"]);
assert.deepEqual(supplierStepsFor(), ["identity", "conditions", "compliance", "review"]);

// What blocks Continue, per step. Declarations and documents never block submission.
const base = { rucDni: "20131312955", legalName: "Proveedor SAC", representativeDocumentType: "DNI", representativeDocumentNumber: "", proposalJustification: "Needed", deliveryMethod: "CENTRAL_WAREHOUSE", bank: "", accountNumber: "", cci: "" };
assert.deepEqual(supplierStepProblems("identity", base), {});
assert.ok(supplierStepProblems("identity", { ...base, rucDni: "123" }).rucDni);
assert.ok(supplierStepProblems("identity", { ...base, legalName: " " }).legalName);
assert.ok(supplierStepProblems("conditions", { ...base, proposalJustification: "" }).proposalJustification);
assert.ok(supplierStepProblems("conditions", { ...base, deliveryMethod: "OTHER", deliveryOther: "" }).deliveryOther);
assert.deepEqual(supplierStepProblems("bank", base, { includeInitialBank: true }), {}, "the account can be added after saving");
assert.ok(supplierStepProblems("bank", { ...base, cci: "00219100000000000002" }, { includeInitialBank: true }).bank, "typed account details need a bank");
assert.match(supplierStepProblems("bank", { ...base, bank: "BCP", cci: "123" }, { includeInitialBank: true }).cci, /20 digits/);
assert.deepEqual(supplierStepProblems("bank", { ...base, bank: "BCP", cci: "002-191-00000000000002" }, { includeInitialBank: true }), {}, "spaces and hyphens are formatting");
assert.deepEqual(supplierStepProblems("compliance", { ...base, stateSanctionsAnswer: "NOT_DECLARED" }), {});

// Review: what Finance still needs before homologation.
const checklist = homologationChecklist({ stateSanctionsAnswer: "NO", complianceModelAnswer: "NOT_DECLARED" }, { documentKinds: new Set(["RUC_FILE"]), files: { bankCertificate: { name: "cert.pdf" } } });
assert.deepEqual(checklist.map((item) => [item.key, item.done]), [["stateSanctions", true], ["complianceModel", false], ["rucFile", true], ["legalRepId", false], ["bankCertificate", true]]);

// The form: one SUNAT panel, translated copy, steps kept mounted (hidden) so data and autofill survive.
assert.match(form, /<WorkflowStepper steps=\{steps\.map\(\(id\) => STEP_LABELS\[id\]\)\}/);
assert.match(form, /const pane = \(id\) => \(\{ "data-step": id, hidden: step !== id \}\);/);
assert.doesNotMatch(form, /REPRESENTANTES LEGALES DE|La información exhibida|UBIGEO SUNAT <|RCO-FOR-002 · Section/);
assert.match(form, /<SunatStatus /);
assert.match(form, /role="radiogroup"/, "declarations are radio groups");
assert.match(form, /onClick=\{\(\) => setFile\(field, null\)\}/, "a chosen document can be removed");
// Continue must never turn into Submit under the pointer, and Enter does not send a new proposal early.
assert.match(form, /<button key="continue" type="button"/);
assert.match(form, /<button key="submit" type="submit"/);
assert.match(form, /if \(!supplier && step !== "review"\) return next\(\);/);
// Problems show next to the fields with one summary above the buttons.
assert.match(form, /<div className="supplier-form-error"><Message type="error">\{error\}<\/Message><\/div>/);
for (const text of ["Identification", "Contacts and conditions", "Declarations and documents", "Needed for homologation", "Legal representatives of {ruc} - {name}", "CCI must contain exactly 20 digits."]) assert.ok(suppliersSpanish[text], `Spanish for "${text}"`);
assert.match(form, /import "\.\.\/\.\.\/styles\/supplierForm\.css";/);

console.log("PASS supplier proposal: steps, per-step rules, homologation checklist, one SUNAT panel, no early submit");
