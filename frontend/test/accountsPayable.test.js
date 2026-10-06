import assert from "node:assert/strict";
import fs from "node:fs";
import accountingSpanish from "../src/context/i18n/accounting.js";
import { cancelBlockedReason, netTransfer } from "../src/utils/payables.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../src/pages/AccountsPayable.jsx");
const detail = read("../src/components/payables/PayableDetail.jsx");

// Work views as tabs with counts (server: backend/src/services/accountsPayableViews.js); the
// view is in the URL and a notification link shows every view.
for (const view of ["open", "due", "bounced", "paid", "all", "credits"]) assert.match(page, new RegExp(`\\["${view}", "`), `${view} tab`);
assert.match(page, /count: id === "credits" \? creditCount : counts\[id\]/);
assert.match(page, /fixedParams: \{ \.\.\.deepLink\.link, view: listView \}/);
assert.match(page, /const listView = deepLink\.active \? "all"/);
assert.match(page, /searchParams\.get\("view"\)/);
assert.match(page, /<SupplierCreditsPanel table=\{creditTable\}/, "supplier credits are a tab, not a second table below");
assert.ok(page.indexOf('hidden={activeTab !== "credits"}') > 0);

// One record view: a row opens the CXP record (no generic Details panel: every column is primary).
assert.match(page, /onRowClick=\{setSelected\}/);
assert.equal((page.match(/primary: true, label:/g) || []).length, 6, "every column stays in the row");
assert.match(page, /row\.paymentPriority === "PRIORITY" && <StatusBadge status="PRIORITY" \/>/, "priority payments are flagged in the row");
assert.doesNotMatch(page, /label: "View CXP details", primary: true/, "the row opens the record; the menu keeps the table narrow");
assert.doesNotMatch(page, /key: "paymentTerms"/, "payment terms moved to the record");

// Cancel stays visible with its reason instead of disappearing.
assert.match(page, /disabled: Boolean\(cancelBlockedReason\(row\)\), disabledReason: cancelBlockedReason\(row\)/);
assert.equal(cancelBlockedReason({ status: "OPEN" }), "");
assert.match(cancelBlockedReason({ status: "PAYMENT_FILE_CREATED" }), /bank file/);
assert.match(cancelBlockedReason({ status: "OPEN", adjustments: [{}] }), /note/);
assert.match(cancelBlockedReason({ status: "SCHEDULED", supplierCreditApplications: [{}] }), /supplier credit/);
assert.match(cancelBlockedReason({ status: "OPEN", detraction: { status: "DEPOSITED" } }), /detraction/);
for (const text of ["Only an unpaid CXP that is not in a bank file can be cancelled.", "The detraction was already deposited, so this CXP can no longer be cancelled."]) assert.ok(accountingSpanish[text], `Spanish for "${text}"`);

// The record is grouped and shows the detraction and the resulting bank transfer.
for (const group of ["Amounts", "Detraction (SPOT)", "Document", "Payment", "Accounting", "CXP history"]) assert.ok(detail.includes(`"${group}"`), `record group ${group}`);
assert.equal(netTransfer({ outstandingAmount: 1180, detraction: { status: "PENDING", amount: 142 } }), 1038);
assert.equal(netTransfer({ outstandingAmount: 1180, detraction: { status: "DEPOSITED", amount: 142 } }), 1180);
assert.equal(netTransfer({ outstandingAmount: 100 }), 100);
assert.match(detail, /paymentTermsSnapshot/);

// Page styles live in their own file.
assert.match(page, /import "\.\.\/styles\/accountsPayable\.css";/);

console.log("PASS accounts payable: work-view tabs with counts, one record view, explained cancel, grouped record with detraction");
