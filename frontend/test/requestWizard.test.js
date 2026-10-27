import assert from "node:assert/strict";
import fs from "node:fs";
import { bankAccountLabel, bankAccountPayload, bankAccountProblems, emptyBankAccount } from "../src/utils/bankAccounts.js";
import { creationExpenseNatures, requestFrequencies, requestFrequencyLabels, requestPriorityLabels } from "../src/utils/options.js";
import { PERU_BANKS, cciBankProblem } from "../../shared/peruBanks.mjs";
import requestWizardSpanish from "../src/context/i18n/requestWizard.js";
import paymentsManualSpanish from "../src/context/i18n/paymentsManual.js";
import simpleSpanish from "../src/context/i18n/simple.js";

// Line endings are normalized: a Windows checkout (core.autocrlf) has CRLF files.
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/RequestCreate.jsx");
const stepBody = (id) => {
  const marker = `{stepId === "${id}" && <div className="wizard-step">`;
  const start = page.indexOf(marker);
  assert.ok(start >= 0, `step ${id} renders`);
  const next = page.indexOf("\n        {stepId === ", start + marker.length);
  return page.slice(start, next > 0 ? next : page.indexOf("</MotionSurface>", start));
};

// 1. One form, four steps in the order the work happens. Track C (paid to the requester) has no
//    supplier and no receipt yet: its first step is the beneficiary and the receipt step is skipped.
assert.match(page, /const stepsFor = \(flowType\) => flowType === "C" \? \["supplier", "details", "review"\] : \["supplier", "invoice", "details", "review"\];/);
assert.match(page, /const STEP_LABELS = \{ supplier: "Supplier details", invoice: "Receipt and automation", details: "Requirement details", review: "Summary and submit" \};/);
assert.equal(requestWizardSpanish["Supplier details"], "Datos de proveedor");
assert.equal(requestWizardSpanish["Receipt and automation"], "Comprobante y automatización");
assert.equal(requestWizardSpanish["Requirement details"], "Detalles del requerimiento");
assert.equal(requestWizardSpanish["Summary and submit"], "Resumen y envío");
assert.doesNotMatch(page, /QuickRequestForm|Use the full form|setMode\(/, "no second version of the form to choose");
// Drafts saved by the earlier forms reopen on the step that now holds their fields.
assert.match(page, /const LEGACY_STEPS = \{ need: "details", budget: "details", documents: "invoice" \};/);

// 2. Step 1, the supplier: search (on the server too), register inline, the account it is paid into.
const supplierStep = stepBody("supplier");
assert.match(supplierStep, /<SearchSelect label="Supplier"[^\n]*onSearch=\{searchSuppliers\}/);
assert.match(supplierStep, /<SupplierQuickRegister /);
assert.match(supplierStep, /name="payment-account"/);
assert.match(supplierStep, /currencyMismatch/, "an account in another currency is flagged");
assert.doesNotMatch(supplierStep, /InvoiceDropZone|BudgetRemainingSummary/);
assert.match(page, /next\.paymentAccount = "Choose the account the supplier is paid into\."/);
// The account's currency becomes the request's unless a receipt set it; nothing is converted.
assert.match(page, /function chooseAccount\(account\)/);

// 3. Step 2, the receipt: read automatically, reviewed and editable, or pending.
const invoiceStep = stepBody("invoice");
assert.match(invoiceStep, /<InvoiceDropZone check=\{invoiceCheck\} onFile=\{readInvoice\}/);
for (const field of ["number", "issueDate", "ruc", "supplierName", "currency", "igvAmount", "totalAmount"]) assert.match(invoiceStep, new RegExp(`invoiceDetails\\.${field}`), `the receipt's ${field} can be checked`);
assert.match(invoiceStep, /Receipt pending/);
assert.match(invoiceStep, /openLocalFile\(file\)/, "the receipt file can be previewed");
assert.match(page, /setInvoiceDetails\(\(current\) => \(\{ \.\.\.current, \.\.\.patch, source: "MANUAL" \}\)\)/, "a corrected value is marked as typed");

// 4. Step 3, the details: priority, frequency, dates, amounts and the budget check beside them.
const detailsStep = stepBody("details");
for (const piece of ["Payment priority and frequency", "requestFrequencies.map", "Requirement date", "<BudgetRemainingSummary ", "creationExpenseNatures", "form.observations"]) assert.ok(detailsStep.includes(piece), `details: ${piece}`);
assert.deepEqual(requestFrequencies, ["ONE_OFF", "MONTHLY_RECURRING", "EVERY_3_MONTHS", "ANNUAL_RENEWAL"]);
assert.deepEqual(Object.values(requestFrequencyLabels), ["Once", "Monthly", "Every 3 months", "Yearly"]);
assert.deepEqual(["Once", "Monthly", "Yearly"].map((label) => requestWizardSpanish[label]), ["Única vez", "Mensual", "Anual"]);
// Payment priority P1-P4 (Manual técnico, "Programación de pagos"); older Alta / Media / Baja read as P2 / P3.
assert.deepEqual(["P1", "P2", "P3", "P4"].map((value) => paymentsManualSpanish[requestPriorityLabels[value]]), ["P1 Crítica", "P2 Urgente", "P3 Normal", "P4 Programada"]);
assert.deepEqual(["ALTA", "MEDIA", "BAJA"].map((value) => requestPriorityLabels[value]), ["P2 Urgent", "P3 Normal", "P3 Normal"]);
// Petty cash and reimbursements are Track C's, not expense types of a new request.
assert.ok(!creationExpenseNatures.includes("PETTY_CASH") && !creationExpenseNatures.includes("REIMBURSEMENT_LIQUIDATION"));

// 5. Step 4, the summary: every part with a way back to its step, then Send.
assert.match(stepBody("review"), /<RequestReview /);
const review = read("../src/components/RequestReview.jsx");
for (const label of ["Account the supplier is paid into", "Receipt issue date", "Requirement date", "Priority", "Frequency", "Detailed description", "Request month", "Supporting documents"]) assert.ok(review.includes(`"${label}"`), `summary shows ${label}`);
assert.match(review, /onEdit\(step\)/);
assert.match(page, /\{stepId === "review" && <ReadinessPanel defaultOpen payload=/);

// 6. One set of rules: Continue checks what Submit checks; a draft needs the supplier and details.
assert.match(page, /function nextStep\(\) \{\n\s*const nextErrors = validationForStep\(stepId, true\);/);
assert.match(page, /goToStep\(checkedSteps\[firstInvalid\]\);\n\s*showProblems\(validations\[firstInvalid\]\);/);
assert.doesNotMatch(page, /localStorage/);

// 7. Bank accounts: the SBS list, savings or current, soles or dollars, CCI checked against the bank.
assert.ok(PERU_BANKS.length >= 20 && PERU_BANKS.some((bank) => bank.code === "OTHER"));
for (const code of ["BCP", "BBVA", "INTERBANK", "SCOTIABANK", "BANCO_NACION", "BANBIF", "PICHINCHA", "MIBANCO"]) assert.ok(PERU_BANKS.some((bank) => bank.code === code), code);
assert.equal(cciBankProblem("BCP", "00219100000000000002"), "");
assert.match(cciBankProblem("BCP", "01119100000000000002"), /another bank/);
assert.equal(cciBankProblem("BANBIF", "01119100000000000002"), "", "a code not yet confirmed is not checked");
const account = { ...emptyBankAccount("Proveedor SAC", "USD"), bank: "BBVA", accountType: "CURRENT", accountNumber: "0011-0175-0100012345", cci: "011-175-000100012345-67" };
assert.deepEqual(bankAccountProblems(account), {});
assert.deepEqual(bankAccountPayload(account), { bank: "BBVA", bankOtherName: "", accountType: "CURRENT", accountCurrency: "USD", currency: "USD", accountNumber: "001101750100012345", cci: "01117500010001234567", accountHolderName: "Proveedor SAC" });
assert.equal(bankAccountLabel({ bank: "BCP", accountType: "SAVINGS", currency: "PEN", accountLast4: "4321" }), "BCP · Savings account · PEN · ****4321");

// 8. The words asked for.
assert.equal(simpleSpanish["A company or person who sells to UMA"], "Una persona que vende servicios a UMA");
assert.equal(simpleSpanish["Money in advance"], "Entrega a rendir");
assert.equal(simpleSpanish["Describe it in a few words"], "Detalla requerimiento");
assert.ok(!Object.values(simpleSpanish).includes("Usar el formulario completo"));

console.log("PASS request wizard: supplier, receipt, details, summary; one rule set; SBS banks, account type and currency");
