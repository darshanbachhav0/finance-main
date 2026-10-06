import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AccountsPayable from "../src/models/AccountsPayable.js";
import { listAccountsPayable } from "../src/controllers/accountingController.js";
import { DUE_SOON_DAYS, dueSoonLimit, payableViewFilter } from "../src/services/accountsPayableViews.js";
import { AP_STATUS, FLOW_TYPE } from "../src/utils/constants.js";

const day = 24 * 60 * 60 * 1000;

async function list(query) {
  let payload;
  let failure;
  await listAccountsPayable({ query }, { json: (body) => { payload = body; } }, (error) => { failure = error; });
  if (failure) throw failure;
  return payload;
}

test("view filters are pure and include overdue items in 'due'", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  assert.deepEqual(payableViewFilter("bounced", now), { status: AP_STATUS.PAYMENT_BOUNCED });
  assert.deepEqual(payableViewFilter("", now), {});
  assert.deepEqual(payableViewFilter("unknown", now), {});
  const due = payableViewFilter("due", now);
  assert.deepEqual(due.status.$in, [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID]);
  assert.equal(due.dueDate.$lte.getTime(), dueSoonLimit(now).getTime());
  assert.ok(dueSoonLimit(now) - now >= DUE_SOON_DAYS * day - day, "about a week ahead");
});

test("Accounts Payable list: tab views and their counts", { timeout: 60000 }, async () => {
  const databaseName = `erp_ap_views_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${databaseName}`);
  try {
    await AccountsPayable.init();
    const now = Date.now();
    let sequence = 0;
    const make = (status, dueInDays, currency = "PEN") => {
      sequence += 1;
      return AccountsPayable.create({
        request: new mongoose.Types.ObjectId(), flowType: FLOW_TYPE.B, supplier: new mongoose.Types.ObjectId(),
        supplierIdentifierSnapshot: "20999999992",
        voucher: { voucherType: "FACTURA", documentType: "FACTURA", series: "F001", number: String(sequence).padStart(4, "0"), documentDate: new Date() },
        originalAmount: 100, currency, exchangeRate: 1, penEquivalent: 100, outstandingAmount: status === AP_STATUS.PAID ? 0 : 100,
        dueDate: dueInDays === null ? undefined : new Date(now + dueInDays * day), status, provisionJournal: new mongoose.Types.ObjectId()
      });
    };
    await make(AP_STATUS.OPEN, 3);                  // due soon
    await make(AP_STATUS.SCHEDULED, -2);            // overdue -> due
    await make(AP_STATUS.PARTIALLY_PAID, 30);       // open, not due
    await make(AP_STATUS.OPEN, null);               // open, date to be confirmed
    await make(AP_STATUS.PAYMENT_BOUNCED, 1);       // bounced (own view, not "due")
    await make(AP_STATUS.PAID, -10);
    await make(AP_STATUS.CANCELLED, 5);
    await make(AP_STATUS.OPEN, 2, "USD");           // due soon, USD

    const counts = (await list({})).summary.viewCounts;
    assert.deepEqual(counts, { open: 5, due: 3, bounced: 1, paid: 1, all: 8 });

    const due = await list({ view: "due" });
    assert.equal(due.pagination.total, 3);
    assert.ok(due.data.every((row) => [AP_STATUS.OPEN, AP_STATUS.SCHEDULED].includes(row.status)));
    assert.deepEqual(due.summary.viewCounts, counts, "counts ignore the selected view");

    assert.equal((await list({ view: "bounced" })).pagination.total, 1);
    assert.equal((await list({ view: "paid" })).pagination.total, 1);
    assert.equal((await list({ view: "all" })).pagination.total, 8);
    assert.equal((await list({ view: "open" })).pagination.total, 5);

    // Other filters narrow the counts too.
    const usd = await list({ currency: "USD" });
    assert.deepEqual(usd.summary.viewCounts, { open: 1, due: 1, bounced: 0, paid: 0, all: 1 });
    // The old status filter still works on its own.
    assert.equal((await list({ status: AP_STATUS.CANCELLED })).pagination.total, 1);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
