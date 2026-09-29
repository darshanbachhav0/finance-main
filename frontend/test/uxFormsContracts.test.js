import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONAL_REQUEST_FIELDS, REQUEST_FORM_BLOCKS, blockForField, requestBlockStatuses } from "../src/utils/requestFormBlocks.js";
import { dniError, identifierError, isValidRuc, openPeriodError, positiveAmountError, requiredError, rucError } from "../src/utils/fieldValidation.js";
import uxformsSpanish from "../src/context/i18n/uxforms.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const tests = [];
const test = (name, callback) => tests.push({ name, callback });

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|mjs)$/.test(name) ? [path] : [];
  });
}

test("no native date, month or datetime-local inputs remain; every page uses DateInput / MonthInput", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const offenders = sourceFiles(root).filter((file) => /type=["{]*["'](date|month|datetime-local)["']|type:\s*"datetime-local"/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
  for (const file of ["pages/RequestCreate.jsx", "pages/AccountingEntries.jsx", "pages/ExternalManagementPortal.jsx", "pages/TreasuryQueue.jsx", "components/SupplierCreditsPanel.jsx", "components/rendition/OfficialRenditionWorkspace.jsx", "components/ResourceManager.jsx", "components/ReportFilters.jsx"]) {
    assert.match(source(`../src/${file}`), /<DateInput /, `${file} uses DateInput`);
  }
  for (const file of ["pages/AccountingEntries.jsx", "pages/AccountingPeriods.jsx", "pages/SireExport.jsx", "components/ReportFilters.jsx"]) {
    assert.match(source(`../src/${file}`), /<MonthInput /, `${file} uses MonthInput`);
  }
  const filters = source("../src/components/ReportFilters.jsx");
  assert.match(filters, /<MonthInput clearable placeholder="All periods"/);
  assert.doesNotMatch(filters, /periodFocused/);
});

test("DateInput is a text field with a keyboard-accessible calendar that emits ISO values", () => {
  const component = source("../src/components/DateInput.jsx");
  assert.match(component, /type="text"/);
  assert.match(component, /inputMode="numeric"/);
  assert.match(component, /role="grid"/);
  assert.match(component, /role="dialog"/);
  for (const key of ["ArrowLeft", "ArrowDown", "PageUp", "Home", "End", "Escape", "Tab"]) assert.ok(component.includes(key), `handles ${key}`);
  assert.match(component, /"Today"/);
  assert.match(component, /aria-current=/);
  assert.match(component, /setCustomValidity/);
  assert.match(component, /const target = \{ value: nextValue, name/);
});

test("request step 1 is grouped into four blocks with a completion badge", () => {
  assert.deepEqual(REQUEST_FORM_BLOCKS.map((block) => block.title), ["What do you need?", "Why?", "Budget", "Items and amounts"]);
  assert.equal(uxformsSpanish["What do you need?"], "¿Qué necesitas?");
  assert.equal(uxformsSpanish["Why?"], "¿Por qué?");
  assert.equal(uxformsSpanish["Items and amounts"], "Ítems y montos");
  assert.equal(uxformsSpanish["More details (optional)"], "Más datos (opcional)");
  assert.equal(uxformsSpanish.Complete, "Completo");
  for (const field of ["flowType", "requestType", "expenseNature", "title", "detailedDescription"]) assert.equal(blockForField(field), "need");
  for (const field of ["businessJustification", "nonApprovalRisk"]) assert.equal(blockForField(field), "why");
  for (const field of ["requesterCostCenter", "issueDate", "accountingPeriod", "currency", "defaultExpenseType", "lines.0.costCenter", "lines.2.expenseType"]) assert.equal(blockForField(field), "budget");
  for (const field of ["lines", "lines.0.quantity", "lines.1.unitPrice", "lines.0.itemDescription", "lines.0.totalAmount"]) assert.equal(blockForField(field), "items");
  assert.deepEqual(OPTIONAL_REQUEST_FIELDS, ["priority", "areaCorrelative", "schoolOrDepartment"]);

  assert.deepEqual(requestBlockStatuses({}), { need: "complete", why: "complete", budget: "complete", items: "complete" });
  assert.deepEqual(requestBlockStatuses({ title: "Requirement title is required.", "lines.0.unitPrice": "Enter a valid unit price." }), { need: "incomplete", why: "complete", budget: "complete", items: "incomplete" });
  assert.equal(requestBlockStatuses({}, { optional: ["why"], filled: { why: false } }).why, "optional");
  assert.equal(requestBlockStatuses({}, { optional: ["why"], filled: { why: true } }).why, "complete");

  const page = source("../src/pages/RequestCreate.jsx");
  for (const id of ["need", "why", "budget", "items"]) assert.match(page, new RegExp(`<RequestFormBlock \\{\\.\\.\\.blockInfo\\.${id}\\} status=\\{blockStatuses\\.${id}\\}`));
  assert.match(page, /<details className="request-optional-fields"/);
  const optional = page.slice(page.indexOf('<details className="request-optional-fields"'), page.indexOf("</details>", page.indexOf('<details className="request-optional-fields"')));
  for (const field of ["form.priority", "form.areaCorrelative", "form.schoolOrDepartment"]) assert.ok(optional.includes(field), `${field} is under More details`);
  assert.ok(page.indexOf("blockInfo.need") < page.indexOf("blockInfo.why") && page.indexOf("blockInfo.why") < page.indexOf("blockInfo.budget") && page.indexOf("blockInfo.budget") < page.indexOf("blockInfo.items"));
  assert.match(source("../src/components/RequestFormBlock.jsx"), /CheckCircle2/);
});

test("every existing request field and the submission payload are unchanged", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  for (const field of ["flowType", "requestType", "expenseNature", "priority", "requesterCostCenter", "defaultExpenseType", "schoolOrDepartment", "areaCorrelative", "issueDate", "accountingPeriod", "currency", "title", "detailedDescription", "businessJustification", "nonApprovalRisk"]) {
    assert.match(page, new RegExp(`value=\\{form\\.${field}`), `${field} still has an input`);
  }
  for (const field of ["projectId", "assetCategory", "usefulLifeYears", "npvAmount", "npvCurrency", "paybackValue", "paybackUnit"]) assert.match(page, new RegExp(`value=\\{capex\\.${field}\\}`));
  assert.match(page, /value=\{opexFrequency\}/);
  assert.match(page, /Object\.entries\(payloadForm\)\.forEach\(\(\[key, value\]\) => data\.append\(key, value \?\? ""\)\)/);
  assert.match(page, /data\.append\("lines", JSON\.stringify\(lines\.map\(requestLinePayload\)\)\)/);
  assert.match(page, /<DateInput required value=\{form\.issueDate\} onChange=\{\(event\) => setForm\(\(current\) => \(\{ \.\.\.current, issueDate: event\.target\.value, accountingPeriod: event\.target\.value\.slice\(0, 7\) \}\)\)\}/);
});

test("fields are validated when the user leaves them, and submit validation is kept", () => {
  const page = source("../src/pages/RequestCreate.jsx");
  for (const field of ["requestType", "expenseNature", "title", "businessJustification", "nonApprovalRisk", "accountingPeriod", "currency"]) assert.match(page, new RegExp(`onBlur=\\{\\(\\) => validateField\\("${field}"`), `${field} is validated on blur`);
  assert.match(page, /validateField\("detailedDescription", "description"\)/);
  assert.match(page, /validateField\("issueDate", "accountingPeriod"\)/);
  assert.match(page, /onFieldBlur=\{field => validateField\(`lines\.\$\{index\}\.\$\{field\}`\)\}/);
  assert.match(page, /onBlur=\{\(\) => validateQuotationAmount\(index\)\}/);
  assert.match(page, /openPeriodError\(form\.issueDate, masters\.periods/);
  assert.match(page, /const validations = \[0, 1, 2\]\.map\(\(index\) => validationForStep\(index, sendForApproval\)\)/);
  assert.match(page, /const nextErrors = validationForStep\(step, false\)/);
  const line = source("../src/components/RequestItemLine.jsx");
  for (const field of ["itemDescription", "quantity", "unitOfMeasure", "unitPrice"]) assert.match(line, new RegExp(`onBlur=\\{blur\\("${field}"\\)\\}`));
  assert.match(line, /field-error/);
  const supplier = source("../src/components/suppliers/SupplierForm.jsx");
  for (const field of ["rucDni", "legalName", "representativeDocumentNumber", "proposalJustification"]) assert.match(supplier, new RegExp(`onBlur=\\{\\(\\) => checkField\\("${field}"\\)\\}`));
  assert.match(supplier, /identifierError\(values\.rucDni\)/);
  assert.match(supplier, /Enter a valid 11-digit RUC or supported 8-digit DNI\./, "submit-time identifier check is kept");
});

test("field validators: RUC check digit, DNI, amounts, required and open periods", () => {
  assert.equal(isValidRuc("20131312955"), true);
  assert.equal(isValidRuc("20131312954"), false, "wrong check digit");
  assert.equal(isValidRuc("30131312955"), false, "invalid prefix");
  assert.equal(identifierError("20131312955"), "");
  assert.equal(identifierError("12345678"), "", "8-digit DNI");
  assert.match(identifierError("20131312954"), /check digit/);
  assert.match(identifierError("2013131295"), /11-digit RUC/);
  assert.match(identifierError("2013A312955"), /digits only/);
  assert.equal(identifierError(""), "This field is required.");
  assert.equal(rucError("20131312955"), "");
  assert.equal(rucError("123"), "A RUC has 11 digits.");
  assert.equal(dniError("1234567"), "A DNI has 8 digits.");
  assert.equal(dniError("", { required: false }), "");
  assert.equal(positiveAmountError("0"), "Enter an amount greater than zero.");
  assert.equal(positiveAmountError("-5"), "Enter an amount greater than zero.");
  assert.equal(positiveAmountError("abc"), "Enter an amount greater than zero.");
  assert.equal(positiveAmountError("0.01"), "");
  assert.equal(positiveAmountError("", { required: false }), "");
  assert.equal(requiredError("  "), "This field is required.");
  assert.equal(requiredError("x"), "");
  const periods = [{ period: "2026-09", status: "OPEN" }, { period: "2026-08", status: "CLOSED" }];
  assert.equal(openPeriodError("2026-09-30", periods), "");
  assert.match(openPeriodError("2026-08-15", periods), /open accounting period/);
  assert.match(openPeriodError("2026-10-01", periods), /open accounting period/);
  assert.equal(openPeriodError("2026-08-15", []), "", "nothing is flagged before periods load");
  for (const message of ["The date must fall within an open accounting period.", "A RUC has 11 digits.", "A DNI has 8 digits.", "Enter an amount greater than zero.", "This RUC is not valid: check the digits (the last one is a check digit).", "Use digits only: 11 for a RUC or 8 for a DNI."]) {
    assert.ok(uxformsSpanish[message], `Spanish for ${message}`);
  }
});

test("form styles live in one labelled block at the end of the stylesheet", () => {
  const styles = source("../src/styles/global.css");
  const start = styles.indexOf("/* ==== ux: forms ====");
  assert.ok(start > styles.indexOf("/* ==== design system (final layer)"));
  assert.equal(styles.indexOf("/* ==== ux: forms ====", start + 1), -1);
  const block = styles.slice(start);
  for (const selector of [".date-input", ".date-picker-popover", ".date-picker-day", ".request-form-block", ".request-block-status", ".request-optional-fields"]) assert.ok(block.includes(selector), selector);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}
