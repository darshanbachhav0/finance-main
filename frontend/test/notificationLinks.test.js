import assert from "node:assert/strict";
import fs from "node:fs";
import { dashboardMetricLink } from "../src/utils/dashboardLinks.js";
import { canAccessNavigation, configurationAccess } from "../src/utils/navigationAccess.js";
import operationsSpanish from "../src/context/i18n/operations.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const backend = (path) => read(`../../backend/src/${path}`);

// 1. Every notification path points at a record, and the target page reads that parameter.
const pages = {
  ApprovalInbox: read("../src/pages/ApprovalInbox.jsx"),
  TreasuryQueue: read("../src/pages/TreasuryQueue.jsx"),
  BudgetControl: read("../src/pages/BudgetControl.jsx"),
  InvoiceObservations: read("../src/pages/InvoiceObservations.jsx"),
  BulkInvoiceUpload: read("../src/pages/BulkInvoiceUpload.jsx"),
  AccountsPayable: read("../src/pages/AccountsPayable.jsx"),
  Suppliers: read("../src/pages/Suppliers.jsx")
};
assert.match(pages.ApprovalInbox, /useDeepLink\(\["request"\]\)/);
assert.match(pages.ApprovalInbox, /fixedParams: deepLink\.link/, "the inbox asks the API for the linked request");
assert.match(pages.ApprovalInbox, /setQuickViewId\(linkedRequest\)/, "the linked request's quick view opens");
assert.match(pages.TreasuryQueue, /useDeepLink\(\["record", "request"\]\)/);
assert.match(pages.TreasuryQueue, /PAYMENT_VIEWS\.includes\(deepLink\.tab\)/, "?tab= selects the payment stage");
assert.match(pages.TreasuryQueue, /stageTotals\.findIndex/, "without a usable tab the first stage holding the CXP opens");
for (const endpoint of ["payment-confirmations", "bounced-payments", "reconciliation", "detractions"]) {
  assert.match(pages.TreasuryQueue, new RegExp(`"/treasury/${endpoint}", linkOptions`), `${endpoint} narrows to the linked CXP`);
}
assert.match(pages.BudgetControl, /searchParams\.get\("request"\)/);
assert.match(pages.BudgetControl, /fixedParams: exceptionLink \|\| \{ period \}/);
assert.match(pages.InvoiceObservations, /useDeepLink\(\["record", "batch", "request"\]\)/);
assert.match(pages.InvoiceObservations, /open\(row\)/);
assert.match(pages.BulkInvoiceUpload, /useDeepLink\(\["batch", "request"\]\)/);
assert.match(pages.BulkInvoiceUpload, /openBatch\(\{ _id: target \}\)/);
assert.match(pages.AccountsPayable, /setSelected\(row\)/);
assert.match(pages.Suppliers, /searchParams\.get\("record"\)/);
// ?record= opens the supplier's own record page.
assert.match(pages.Suppliers, /navigate\(`\/suppliers\/\$\{linkedSupplierId\}`, \{ replace: true \}\)/);
for (const [name, source] of Object.entries(pages)) {
  if (name === "Suppliers") continue;
  assert.match(source, /<DeepLinkNotice /, `${name} tells the user it shows one linked record and offers the full list`);
}
assert.match(read("../src/hooks/usePaginatedResource.js"), /deepLink \? null : JSON\.parse/, "a deep link ignores the saved search/filters that could hide the record");

// Backend call sites: a notification never points at a bare list. The few one-line call sites
// that still pass "/treasury" or "/budget" carry a request entity, which recordLinkFor turns
// into the record link when the notification is stored.
const callSites = ["services/accountingService.js", "services/approvalService.js", "services/treasuryService.js", "services/invoiceRegistrationService.js", "services/batchInvoiceService.js", "services/bankNotificationService.js", "services/renditionService.js", "services/budgetExceptionService.js"];
for (const file of callSites) {
  const source = backend(file);
  assert.doesNotMatch(source, /path: "\/(accounting\/invoice-observations|suppliers|batch-invoices|approvals)"[,\s]/, `${file} has no bare list path`);
  for (const match of source.matchAll(/path: "\/(treasury|budget)"/g)) {
    const statement = source.slice(match.index, source.indexOf("}", match.index));
    assert.match(statement, /entityType: "(FinancialRequest|AccountsPayable|BudgetException)", entityId: /, `${file}: bare ${match[0]} is resolved from its entity`);
  }
}
assert.match(backend("services/treasuryService.js"), /path: `\/treasury\?tab=confirm&record=\$\{item\.accountsPayable\._id\}`/);
assert.match(backend("services/notificationService.js"), /path: `\/approvals\?request=\$\{request\._id\}`/);
assert.match(backend("services/notificationService.js"), /export function recordLinkFor/, "remaining bare paths are resolved from the notification entity");
assert.equal(fs.existsSync(new URL("../../backend/src/services/workflowTaskPolicy.js", import.meta.url)), false, "the unused task policy was removed");
for (const file of ["services/approvalService.js", "services/treasuryService.js", "services/batchInvoiceService.js", "controllers/accountingController.js"]) {
  assert.match(backend(file), /withDeepLink\(/, `${file} list endpoint honours the deep link`);
}
// The bell navigates and marks the notification read.
assert.match(read("../src/layouts/AppLayout.jsx"), /to=\{item\.path \|\| "\/"\}[^>]*onClick=\{\(\) => \{ setTaskOpen\(false\); markNotificationRead\(item\); \}\}/);

// 2. Accounting mappings configuration resource for Admin and Accounting.
assert.deepEqual(configurationAccess["accounting-mappings"], ["Admin", "Accounting"]);
for (const role of ["Admin", "Accounting"]) assert.equal(canAccessNavigation(role, "/configuration/accounting-mappings"), true);
for (const role of ["Treasury", "Budget", "Solicitor"]) assert.equal(canAccessNavigation(role, "/configuration/accounting-mappings"), false);
const master = read("../src/pages/MasterConfiguration.jsx");
const block = master.slice(master.indexOf(`"accounting-mappings": {`), master.indexOf(`"bank-formats": {`));
assert.match(block, /endpoint: "\/accounting-mappings"/);
for (const field of ["code", "name", "purpose", "requestType", "expenseNature", "bank", "currency", "accountNumber", "subAccount", "active"]) {
  assert.match(block, new RegExp(`name: "${field}"`), `mapping form edits ${field}`);
}
const modelPurposes = backend("models/AccountingMapping.js").match(/enum: \[("ACCOUNTS_PAYABLE"[^\]]*)\]/)[1].match(/"([A-Z_]+)"/g).map((value) => value.replaceAll("\"", ""));
const purposesBlock = master.slice(master.indexOf("accountingMappingPurposes = ["), master.indexOf("const purposeLabel"));
for (const purpose of modelPurposes) assert.match(purposesBlock, new RegExp(`value: "${purpose}"`), `purpose select offers ${purpose}`);
assert.match(backend("routes/masterDataRoutes.js"), /accountingMappingRouter\.use\(protect, authorize\(ROLES\.ADMIN, ROLES\.ACCOUNTING\)\)/);
assert.match(read("../src/utils/navigationAccess.js"), /"\/configuration\/accounting-mappings": "Accounting Mappings"/, "the page has a name in the shared navigation (Settings lists it)");
assert.match(read("../src/pages/AccountingEntries.jsx"), /\["Accounting Mappings", "\/configuration\/accounting-mappings"\]/);
assert.doesNotMatch(read("../../docs/ARCHITECTURE.md"), /An admin screen for accounting mappings/);

// 3. Dashboard link labels are translated.
assert.equal(dashboardMetricLink("Solicitor", "rendition").actionLabel, "View pending renditions");
for (const label of ["View pending renditions", "Review requests", "Accounting Mappings", "Show all payments", "Showing the payment linked from your notification"]) {
  assert.ok(operationsSpanish[label], `${label} has a Spanish translation`);
}

// 4. SLA escalation counters use the working-day rule.
assert.doesNotMatch(backend("services/externalManagementService.js"), /SLA_ESCALATION_HOURS/);
assert.doesNotMatch(backend("controllers/dashboardController.js"), /escalationHours \* 3600000/);
assert.match(backend("controllers/dashboardController.js"), /countEscalatedApprovals\(escalationScope/);

console.log("PASS notification deep links, accounting mappings screen, dashboard labels and working-day SLA counters");
