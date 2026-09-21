import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetMeasures, fetchAllPages, notificationCategory, quotationDifference, slaCountdown, validateFiles } from "../src/utils/experience.js";
import { searchSources } from "../src/utils/searchSources.js";

test("SLA countdown stops for resolved, terminal and invalid due dates", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  assert.deepEqual(slaCountdown({ status: "PENDIENTE_APROBACION", approvalDueAt: "2026-09-22T14:30:00Z" }, now), { overdue: false, days: 1, hours: 2, minutes: 30 });
  assert.equal(slaCountdown({ status: "APROBADO_DIRECTOR", approvalDueAt: "2026-09-20T12:00:00Z" }, now).overdue, true);
  for (const status of ["RECHAZADO", "CERRADO", "ANULADO", "PAGADO", "APROBADO_VICERRECTOR"]) assert.equal(slaCountdown({ status, approvalDueAt: "2026-09-20" }, now), null);
  assert.equal(slaCountdown({ status: "PENDIENTE_APROBACION", approvalDueAt: "bad" }, now), null);
});
test("budget bars preserve independent paid and executed evidence without stacking", () => {
  const values = budgetMeasures({ assigned: 100, committed: 20, executed: 60, paid: 40, available: 20 });
  assert.equal(values.find(item => item.key === "paid").percent, 40);
  assert.equal(values.find(item => item.key === "executed").percent, 60);
  assert.equal(budgetMeasures({ assigned: 100, available: -20 }).at(-1).value, -20);
  assert.equal(budgetMeasures({ assigned: 0 }).at(-1).percent, 0);
});
test("quotation comparisons never compare different currencies or incomplete amounts", () => {
  const rows = [{ currency: "PEN", amount: 300 }, { currency: "USD", amount: 50 }, { currency: "PEN", amount: 400 }];
  assert.deepEqual(quotationDifference(rows[2], rows), { lowest: false, difference: 100 });
  assert.equal(quotationDifference(rows[1], rows), null);
  assert.equal(quotationDifference({ currency: "PEN", amount: "" }, rows), null);
});
test("upload selection rejects unsupported, empty and excess files", () => {
  const pdf = { name: "invoice.PDF", type: "application/pdf", size: 120 };
  assert.equal(validateFiles([pdf], ".pdf"), "");
  assert.ok(validateFiles([pdf, pdf], ".pdf"));
  assert.ok(validateFiles([{ ...pdf, size: 0 }], ".pdf"));
  assert.ok(validateFiles([pdf], ".xml"));
  assert.equal(validateFiles([{ name: "photo.png", size: 2, type: "image/png" }], "image/*"), "");
});
test("calendar pagination includes every page and fails rather than displaying partial totals", async () => {
  const calls = [];
  const api = { get: async (_, config) => { calls.push(config.params.page); return { data: { data: [{ _id: config.params.page }], pagination: { totalPages: 3 } } }; } };
  assert.equal((await fetchAllPages(api, "/queue", {}, new AbortController().signal)).length, 3);
  assert.deepEqual(calls, [1, 2, 3]);
  const failing = { get: async (_, config) => { if (config.params.page === 2) throw new Error("unavailable"); return { data: { data: [1], pagination: { totalPages: 2 } } }; } };
  await assert.rejects(fetchAllPages(failing, "/queue", {}), /unavailable/);
});
test("search sources preserve role boundaries and management viewer isolation", () => {
  assert.deepEqual(searchSources("ManagementViewer"), []);
  assert.deepEqual(searchSources("Approver").map(item => item.endpoint), ["/requests"]);
  assert.ok(!searchSources("Solicitor").some(item => item.endpoint.startsWith("/accounting")));
  assert.ok(!searchSources("Treasury").some(item => item.endpoint === "/cost-centers"));
  assert.ok(searchSources("Accounting").some(item => item.endpoint === "/accounting/accounts-payable"));
});
test("notifications classify existing SLA, workflow and payment alerts", () => {
  assert.equal(notificationCategory({ type: "SLA_ESCALATION" }), "SLA");
  assert.equal(notificationCategory({ type: "APPROVAL_PENDING" }), "Approvals");
  assert.equal(notificationCategory({ type: "PAYMENT_CONFIRMED" }), "Payments");
  assert.equal(notificationCategory({ type: "SUPPLIER_CREATED" }), "Other");
});
