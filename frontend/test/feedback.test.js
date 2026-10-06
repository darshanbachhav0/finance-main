import assert from "node:assert/strict";
import fs from "node:fs";
import { pageTrail } from "../src/utils/navigationAccess.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const listFiles = (dir) => fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(`${dir}${entry.name}/`) : entry.name.endsWith(".jsx") ? [`${dir}${entry.name}`] : []);

// 1. A failed action is reported once, where the person acted. Error toasts remain only where
//    there is no inline place (a download button, the online exchange-rate fetch).
const toastAllowed = new Set(["../src/components/ProtectedAssetButton.jsx", "../src/pages/ExchangeRates.jsx"]);
for (const file of [...listFiles("../src/pages/"), ...listFiles("../src/components/")]) {
  const source = read(file);
  const errorToasts = source.match(/notify\(\s*(err|error)\.message[^)]*,\s*"error"/g) || [];
  if (!toastAllowed.has(file)) assert.equal(errorToasts.length, 0, `${file} repeats an inline error as a toast`);
}

// 2. Panels and dialogs show the error of an action taken in them, above their buttons, and
//    only errors raised while they are open.
const drawer = read("../src/components/Drawer.jsx");
const dialog = read("../src/components/ConfirmDialog.jsx");
assert.match(drawer, /useFreshError\(open, error\)/);
assert.match(drawer, /className="drawer-error"/);
assert.match(dialog, /useFreshError\(open, error\)/);
assert.match(dialog, /className="dialog-error"/);
assert.match(read("../src/hooks/useFreshError.js"), /if \(open && !wasOpen\.current\) stale\.current = error \|\| null;/);
// An inline error scrolls into view when it appears.
assert.match(read("../src/components/Message.jsx"), /scrollIntoView\(\{ block: "center"/);
// Pages pass their action error to the panel the action runs in, and keep it off the page banner meanwhile.
for (const [page, panel] of [["TreasuryQueue", "paymentRow"], ["AccountingEntries", "selectedRequest"], ["AccountingPeriods", "createOpen"], ["EmployeeReimbursementBanking", "drawer"]]) {
  const source = read(`../src/pages/${page}.jsx`);
  assert.match(source, /<Drawer open=\{[^}]*\}+ error=\{(actionError|error)\}/, `${page} panel shows its error`);
  assert.ok(source.includes(`(${panel}`) || source.includes(`{${panel} ? "" :`), `${page} banner skips errors shown in the panel`);
}
assert.doesNotMatch(read("../src/components/ResourceManager.jsx"), /JSON\.stringify\(err\.details\)/);
// The request form shows one summary next to its buttons, not a banner plus a toast.
const create = read("../src/pages/RequestCreate.jsx");
assert.match(create, /<div className="wizard-error"><Message type="error">\{error\}<\/Message><\/div>\n\s*<footer className="wizard-actions">/);
assert.doesNotMatch(create, /notify\(summary, "error"/);
// Invoice registration errors stay next to the invoice form.
assert.match(read("../src/pages/RequestDetail.jsx"), /<Message type="error">\{invoiceError\}<\/Message>\n\s*<button className="primary-button" type="submit" disabled=\{invoiceSubmitting\}>/);

// 3. One record pattern: the header keeps Back and Print; every action is in the action panel.
const detail = read("../src/pages/RequestDetail.jsx");
const header = detail.slice(detail.indexOf("<PageHeader"), detail.indexOf("<Message type=\"error\">{error}</Message>"));
assert.doesNotMatch(header, /Edit request|Delete/, "no workflow actions in the request header");
const panel = detail.slice(detail.indexOf('id="request-actions"'));
assert.match(panel, /to=\{`\/requests\/\$\{id\}\/edit`\}/, "Edit sits in the action panel");
assert.match(panel, /className="action-panel-danger"/, "destructive actions are grouped last");
assert.match(panel, /type: "delete"/);
assert.match(detail, /aria-describedby="request-submit-reason"/, "a disabled Submit says why in visible text");
// One status strip; Approvals and History render in the main column.
assert.doesNotMatch(detail.slice(detail.indexOf('<dl className="request-overview">'), detail.indexOf("</dl>", detail.indexOf('<dl className="request-overview">'))), /Current status/);
assert.match(detail, /<div className="stage-row" role="group" aria-label=\{t\("Current status"\)\}>\n\s*<FinancialProgressSummary/);
const main = detail.slice(detail.indexOf('<div className="request-detail-main">'), detail.indexOf('<aside className="request-detail-side"'));
assert.ok(main.includes('activeTab !== "Approvals"') && main.includes('activeTab !== "History"'));

// 4. Supplier records are pages; the list opens them.
assert.match(read("../src/App.jsx"), /<Route path=":id" element=\{<Suppliers \/>\} \/>/);
const suppliers = read("../src/pages/Suppliers.jsx");
assert.match(suppliers, /navigate\(`\/suppliers\/\$\{id\}\$\{location\.search\}`, \{ state: \{ mode \} \}\)/, "opening a record keeps draft-resume parameters");
assert.match(suppliers, /if \(recordId\) \{\n\s*return \(\n\s*<div className="page-shell supplier-page supplier-record-page">/);
assert.deepEqual(pageTrail("/suppliers/0123456789abcdef01234567", { role: "Accounting" }).map((item) => item.label), ["Dashboard", "Suppliers", "Supplier record"]);

// 5. List actions: approvers see what they decide on; no duplicate menu actions.
const inbox = read("../src/pages/ApprovalInbox.jsx");
assert.match(inbox, /key: "supplier"/);
assert.match(inbox, /row\.title \|\| row\.description/);
assert.doesNotMatch(inbox.slice(inbox.indexOf("rowActions={(row) => ["), inbox.indexOf("columns={[")), /label: "Reject"/, "Reject is already a Decision button");

console.log("PASS feedback: one error per action, shown where it happened; one record pattern; supplier record pages");
