import assert from "node:assert/strict";
import fs from "node:fs";
import suppliersSpanish from "../src/context/i18n/suppliers.js";
import { homologationChecklist, supplierStepProblems, supplierStepsFor } from "../src/utils/supplierProposal.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const form = read("../src/components/suppliers/SupplierForm.jsx");

// Steps: the bank step exists only where the form registers the first accounts (new proposals).
// The declarations and documents step was removed from the form.
assert.deepEqual(supplierStepsFor({ includeInitialBank: true }), ["identity", "conditions", "bank", "review"]);
assert.deepEqual(supplierStepsFor(), ["identity", "conditions", "review"]);

// What blocks Continue, per step.
const account = (patch = {}) => ({ bank: "", bankOtherName: "", accountType: "SAVINGS", accountCurrency: "PEN", accountNumber: "", cci: "", accountHolderName: "Proveedor SAC", ...patch });
const base = { rucDni: "20131312955", legalName: "Proveedor SAC", representativeDocumentType: "DNI", representativeDocumentNumber: "", proposalJustification: "Needed", deliveryMethod: "CENTRAL_WAREHOUSE", bankAccounts: [account()] };
assert.deepEqual(supplierStepProblems("identity", base), {});
assert.ok(supplierStepProblems("identity", { ...base, rucDni: "123" }).rucDni);
assert.ok(supplierStepProblems("identity", { ...base, legalName: " " }).legalName);
assert.ok(supplierStepProblems("conditions", { ...base, proposalJustification: "" }).proposalJustification);
assert.ok(supplierStepProblems("conditions", { ...base, deliveryMethod: "OTHER", deliveryOther: "" }).deliveryOther);
assert.deepEqual(supplierStepProblems("bank", base, { includeInitialBank: true }), {}, "the account can be added after saving");
assert.ok(supplierStepProblems("bank", { ...base, bankAccounts: [account({ cci: "00219100000000000002" })] }, { includeInitialBank: true })["bankAccounts.0.bank"], "typed account details need a bank");
assert.match(supplierStepProblems("bank", { ...base, bankAccounts: [account({ bank: "BCP", accountNumber: "191", cci: "123" })] }, { includeInitialBank: true })["bankAccounts.0.cci"], /20 digits/);
assert.deepEqual(supplierStepProblems("bank", { ...base, bankAccounts: [account({ bank: "BCP", accountNumber: "191-00000000", cci: "002-191-00000000000002" })] }, { includeInitialBank: true }), {}, "spaces and hyphens are formatting");
assert.match(supplierStepProblems("bank", { ...base, bankAccounts: [account({ bank: "BCP", accountNumber: "191", cci: "01119100000000000002" })] }, { includeInitialBank: true })["bankAccounts.0.cci"], /another bank/, "a BBVA CCI is not a BCP account");
assert.ok(supplierStepProblems("bank", { ...base, bankAccounts: [account({ bank: "OTHER", accountNumber: "191", cci: "09919100000000000002" })] }, { includeInitialBank: true })["bankAccounts.0.bankOtherName"], "Other needs the bank's name");
// Two accounts, one in soles and one in dollars, are both checked.
const two = supplierStepProblems("bank", { ...base, bankAccounts: [account({ bank: "BCP", accountNumber: "191", cci: "00219100000000000002" }), account({ bank: "BBVA", accountCurrency: "USD", accountNumber: "", cci: "01100000000000000001" })] }, { includeInitialBank: true });
assert.ok(two["bankAccounts.1.accountNumber"] && !two["bankAccounts.0.accountNumber"]);

// Review: what the jefe checks before approving.
const checklist = homologationChecklist({ ...base, personType: "LEGAL_ENTITY", fiscalAddress: "Av. Lima 1", bankAccounts: [account({ bank: "BCP" })] });
assert.deepEqual(checklist.map((item) => [item.key, item.done]), [["personType", true], ["fiscalAddress", true], ["legalRepresentative", false], ["bankAccount", true]]);

// The form: one SUNAT panel, translated copy, steps kept mounted (hidden) so data and autofill survive.
assert.match(form, /<WorkflowStepper steps=\{steps\.map\(\(id\) => STEP_LABELS\[id\]\)\}/);
assert.match(form, /const pane = \(id\) => \(\{ "data-step": id, hidden: step !== id \}\);/);
assert.doesNotMatch(form, /REPRESENTANTES LEGALES DE|La información exhibida|UBIGEO SUNAT <|RCO-FOR-002 · Section/);
assert.match(form, /<SunatStatus /);
assert.doesNotMatch(form, /DeclarationField|SUPPLIER_DOCUMENTS|setFile\(/, "no declarations or mandatory documents in the form");
assert.match(form, /<BankAccountFields value=\{account\}/, "one shared bank account component");
assert.match(form, /payload\.append\("bankAccounts", JSON\.stringify\(accounts\)\)/, "every account is sent");
// Continue must never turn into Submit under the pointer, and Enter does not send a new proposal early.
assert.match(form, /<button key="continue" type="button"/);
assert.match(form, /<button key="submit" type="submit"/);
assert.match(form, /if \(!supplier && step !== "review"\) return next\(\);/);
// Problems show next to the fields with one summary above the buttons.
assert.match(form, /<div className="supplier-form-error"><Message type="error">\{error\}<\/Message><\/div>/);
for (const text of ["Identification", "Contacts and conditions", "Legal representatives of {ruc} - {name}", "CCI must contain exactly 20 digits."]) assert.ok(suppliersSpanish[text], `Spanish for "${text}"`);
assert.match(form, /import "\.\.\/\.\.\/styles\/supplierForm\.css";/);

console.log("PASS supplier proposal: steps, per-step rules, homologation checklist, one SUNAT panel, no early submit");
