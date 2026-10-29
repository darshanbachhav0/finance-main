import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultOpenPeriod, quickTrack, quickTrackText, showCapexDetails, titleFromDescription } from "../src/utils/quickRequest.js";
import { PLAIN_STATUSES, plainNextStep, plainStatusFilterOptions, plainStatusKey, usesPlainStatuses } from "../src/utils/plainStatus.js";
import { linesFromInvoice } from "../src/utils/invoiceAutofill.js";
import { exportCellValue, xlsxBytes } from "../src/utils/xlsx.js";
import { accountMenuPaths, canAccessNavigation, navigationForUser, pageTrail } from "../src/utils/navigationAccess.js";
import { REQUEST_LIFECYCLE } from "../../shared/workflowStatus.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// 1. The simple request form: the answers choose the track; nobody picks A1 / B / C.
// A1 and B both take a quote, the invoice or both; "how is it paid?" decides between them.
assert.deepEqual(quickTrack({ payee: "supplier", route: "direct" }), { flowType: "B", requestType: "OPEX" });
assert.deepEqual(quickTrack({ payee: "supplier", route: "order" }), { flowType: "A1", requestType: "OPEX" });
assert.deepEqual(quickTrack({ payee: "supplier", route: "order", capex: true }), { flowType: "A1", requestType: "CAPEX" });
assert.deepEqual(quickTrack({ payee: "employee", employeeNeed: "advance" }), { flowType: "C", requestType: "ENTREGA_RENDIR" });
assert.deepEqual(quickTrack({ payee: "employee", employeeNeed: "reimbursement", capex: true }), { flowType: "C", requestType: "REEMBOLSO_SIN_SUSTENTO" });
assert.match(quickTrackText({ flowType: "B" }), /Direct payment/);
assert.match(quickTrackText({ flowType: "C", requestType: "ENTREGA_RENDIR" }), /Advance/);
assert.equal(titleFromDescription("\n  2 toners for the lab\nfor Monday"), "2 toners for the lab");
assert.equal(titleFromDescription("x".repeat(300)).length, 120);
const periods = [{ period: "2026-09", status: "CLOSED" }, { period: "2026-10", status: "OPEN" }, { period: "2026-11", status: "OPEN" }];
assert.equal(defaultOpenPeriod(periods, "2026-10"), "2026-10");
assert.equal(defaultOpenPeriod(periods, "2026-09"), "2026-10", "a closed month moves to the next open one");
assert.equal(defaultOpenPeriod(periods, "2026-12"), "2026-11", "after the last open month: the latest open one");
assert.equal(defaultOpenPeriod([], "2026-10"), "");
// CAPEX planning fields only for large purchases, or once something was typed.
assert.equal(showCapexDetails({ total: 1000, threshold: 50000, capex: {} }), false);
assert.equal(showCapexDetails({ total: 60000, threshold: 50000, capex: {} }), true);
assert.equal(showCapexDetails({ total: 1000, threshold: 50000, capex: { assetCategory: "IT_HARDWARE" } }), true);
const create = read("../src/pages/RequestCreate.jsx");
// One request form: no "simple" and "full" versions to choose between.
assert.doesNotMatch(create, /QuickRequestForm|setMode\(|Use the full form|openFullForm/, "one form, no full-form switch");
assert.match(create, /changeTrack\(\{ route: "order" \}\)/, "who is paid and how decide the track");
assert.match(create, /capex-details/, "CAPEX planning details are collapsible");
assert.doesNotMatch(create, /\["nonApprovalRisk", "Risk if not approved is required\."\]/, "the risk if not approved is optional");
// A quote or the receipt, at least one.
assert.match(create, /next\.quote = "Attach the receipt or the supplier's quote \(at least one\)\."/);
assert.match(create, /quotations\.filter\(quotationHasData\)\.map/, "an empty quotation card is not sent");
assert.match(create, /onClick=\{addQuote\}/, "more quotations can be added");
assert.match(create, /<InvoiceDropZone/);

// 2. "Invoice in, request out": one line per factura item when they add up to its totals.
const invoice = { netAmount: 250, igvAmount: 45, totalAmount: 295, lines: [{ description: "Toner", quantity: 2, unitCode: "NIU", netAmount: 200, igvAmount: 36, totalAmount: 236 }, { description: "Delivery", quantity: 1, unitCode: "ZZ", netAmount: 50, igvAmount: 9, totalAmount: 59 }] };
const lines = linesFromInvoice(invoice, { costCenter: "cc" });
assert.equal(lines.length, 2);
assert.deepEqual(lines.map((line) => [line.itemDescription, line.quantity, line.unitOfMeasure, line.totalAmount, line.costCenter]), [["Toner", "2", "UNIT", 236, "cc"], ["Delivery", "1", "SERVICE", 59, "cc"]]);
assert.equal(lines[0].priceIncludesIGV, false);
assert.equal(lines[0].unitPrice, "100");
const mismatched = linesFromInvoice({ ...invoice, totalAmount: 300 }, { costCenter: "cc", description: "Invoice F001-1" });
assert.equal(mismatched.length, 1, "items that do not add up: one line with the invoice totals");
assert.equal(mismatched[0].totalAmount, 300);

// 3. Requesters see four plain steps and what is needed from them.
assert.deepEqual(Object.keys(PLAIN_STATUSES), ["DRAFT", "NEEDS_CHANGES", "WAITING", "IN_PROCESS", "PAID", "REJECTED", "CANCELLED"]);
const covered = Object.values(PLAIN_STATUSES).flatMap((item) => item.statuses);
for (const status of REQUEST_LIFECYCLE) assert.ok(covered.includes(status), `${status} has a plain status`);
assert.equal(plainStatusKey({ status: "DEVUELTO" }), "NEEDS_CHANGES");
assert.equal(plainStatusKey({ status: "PROGRAMADO" }), "IN_PROCESS");
assert.equal(plainStatusKey({ status: "PAGADO_CERRADO" }), "PAID", "legacy aliases follow their current status");
assert.equal(plainNextStep({ status: "OBSERVADO" }).yours, true);
assert.deepEqual(plainNextStep({ status: "PENDIENTE_APROBACION", approvalRouteSnapshot: [{ sequence: 1, status: "PENDING", approverSnapshot: { name: "Rosa" } }] }), { text: "Nothing. Waiting for {name}.", params: { name: "Rosa" }, yours: false });
assert.equal(plainNextStep({ status: "PAGADO", flowType: "C", requestType: "ENTREGA_RENDIR", rendition: { status: "PENDING" } }).yours, true, "an advance still needs its rendition");
assert.equal(plainNextStep({ status: "COMPROMISO_PRESUPUESTAL", flowType: "C", requestType: "REEMBOLSO_SIN_SUSTENTO" }).yours, true);
assert.equal(plainStatusFilterOptions.find((option) => option.label === "Paid").value, "PAGADO,CONCILIADO,CERRADO");
assert.equal(usesPlainStatuses({ role: "Solicitor" }), true);
assert.equal(usesPlainStatuses({ role: "Accounting" }), false);

// 4. The requester's menu stays at their requests and suppliers; guides and special requests open
//    from their pages, not the menu; their bank account is in the account menu.
const solicitor = { role: "Solicitor", hasTeam: false, permissions: [] };
assert.deepEqual(navigationForUser(solicitor).map(([, path]) => path), ["/", "/requests/new", "/requests", "/suppliers"]);
for (const path of ["/guides", "/special-expenses"]) {
  assert.ok(!navigationForUser(solicitor).some(([, item]) => item === path), `${path} is not in the Solicitor's menu`);
  assert.ok(canAccessNavigation(solicitor, path), `${path} still opens for the Solicitor`);
}
assert.deepEqual(accountMenuPaths(solicitor), ["/reimbursement-bank"]);
assert.deepEqual(accountMenuPaths({ role: "Accounting", permissions: [] }), []);
// Tesorería validates suppliers and their bank accounts, so Suppliers is in its menu; Contabilidad
// still opens the page.
assert.ok(navigationForUser({ role: "Treasury", permissions: [] }).some(([, path]) => path === "/suppliers"), "Treasury keeps Suppliers in its menu");
assert.ok(canAccessNavigation({ role: "Accounting", permissions: [] }, "/suppliers"));
assert.deepEqual(pageTrail("/approvals/0123456789abcdef01234567", { role: "AreaDirector" }).map((item) => item.label), ["Home", "Approvals", "Your decision"]);

// 5. Approvers: three decisions and a one-page approval for the email link.
const inbox = read("../src/pages/ApprovalInbox.jsx");
assert.match(inbox, /t\("Send back"\)/);
assert.doesNotMatch(inbox, /label: "Return"/, "Return is one of the three decisions now (Send back)");
assert.match(inbox, /navigate\(`\/approvals\/\$\{linkedRequest\}`/, "old approve-now links open the one-page approval");
assert.match(read("../src/App.jsx"), /<Route path=":id" element={<ApprovalDecision \/>} \/>/);
const decision = read("../src/pages/ApprovalDecision.jsx");
for (const action of ["approve", "observe", "reject"]) assert.match(decision, new RegExp(`${action}: \\{ label:`));

// 6. Every list exports a real Excel file.
assert.match(read("../src/components/DataTable.jsx"), /exportable = true/);
const bytes = xlsxBytes([["Request", "Amount"], ["SOL-1 <&>", 1250.5]]);
assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "a ZIP (xlsx) file");
const text = new TextDecoder().decode(bytes);
assert.match(text, /<c r="B2"><v>1250\.5<\/v><\/c>/, "numbers stay numbers");
assert.match(text, /SOL-1 &lt;&amp;&gt;/, "text is escaped");
assert.equal(exportCellValue({ legalName: "Andino" }), "Andino");
assert.equal(exportCellValue(12), 12);

console.log("PASS simpler platform: quick form, plain statuses, short menus, approvals, Excel export");
