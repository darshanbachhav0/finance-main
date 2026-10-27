import assert from "node:assert/strict";
import test from "node:test";
import FinancialRequest from "../src/models/FinancialRequest.js";
import AccountsPayable from "../src/models/AccountsPayable.js";
import { capturePayablePaymentTerms, resolvePayableDueDate } from "../src/services/payablePaymentTermsService.js";
import { parseQuotations } from "../src/services/requestService.js";
import { validateStructuredQuotationComparison } from "../src/services/documentRuleService.js";
import { selectedQuotationPaymentTerms } from "../src/services/purchaseOrderService.js";
import { normalizePaymentTerms, paymentBreakdown, paymentTermsSummary, validatePaymentTerms } from "../../shared/paymentTerms.mjs";

const split = { paymentCondition: "ADVANCE_AND_BALANCE", advancePercentage: 30, balanceTiming: "ON_DELIVERY" };

test("payables prefer frozen order terms, then the selected quotation, with a legacy fallback", async () => {
  const supplier = { _id: "507f1f77bcf86cd799439011", paymentTerms: { option: "CREDIT_45", days: 45 } };
  const request = { supplier, quotations: [{ ...split, recommended: true, supplier: supplier._id, amount: 3540, currency: "PEN" }] };
  const frozen = { paymentCondition: "CREDIT", creditDays: 15, creditStart: "INVOICE", paymentNotes: "Original agreement" };
  const snapshot = capturePayablePaymentTerms({ request, supplier, purchaseOrder: { paymentTermsSnapshot: frozen } });
  assert.equal(snapshot.source, "PURCHASE_ORDER");
  assert.equal(snapshot.creditDays, 15);
  assert.equal(snapshot.option, undefined);
  const direct = capturePayablePaymentTerms({ request, supplier });
  assert.equal(direct.source, "QUOTATION");
  assert.equal(direct.advancePercentage, 30);
  assert.equal(direct.balancePercentage, 70);
  const historical = capturePayablePaymentTerms({ request, supplier, purchaseOrder: {} });
  assert.equal(historical.option, "CREDIT_45", "An old issued order must not adopt a newly edited quotation");
  assert.equal(historical.source, "SUPPLIER_DEFAULT");
  assert.equal(capturePayablePaymentTerms({ request: { quotations: [] }, supplier: {} }), undefined);
  const record = new AccountsPayable({ request: supplier._id, supplierIdentifierSnapshot: "20600000001", originalAmount: 3540, outstandingAmount: 3540, currency: "PEN", exchangeRate: 1, penEquivalent: 3540, paymentTermsSnapshot: direct });
  await record.validate();
  assert.equal(record.toObject().paymentTermsSnapshot.balancePercentage, 70);
  assert.equal(record.toObject().paymentTermsSnapshot.quotationAmount, 3540);
  assert.equal(paymentTermsSummary(historical), "CREDIT_45 · 45 days");
});

test("payable due dates follow known dates without replacing milestone terms with supplier credit", () => {
  const voucher = { issueDate: "2026-09-01" };
  const resolve = (paymentTermsSnapshot, rest = {}) => resolvePayableDueDate({ voucher, paymentTermsSnapshot, flowType: "A1", ...rest });
  assert.equal(resolve({ paymentCondition: "CREDIT", creditDays: 15, creditStart: "INVOICE" }).toISOString().slice(0, 10), "2026-09-16");
  assert.equal(resolve({ paymentCondition: "100%_ADVANCE" }).toISOString().slice(0, 10), "2026-09-01");
  for (const terms of [split, { paymentCondition: "100%_ON_DELIVERY" }, { paymentCondition: "CREDIT", creditDays: 30, creditStart: "CONFORMITY" }, { paymentConditions: "As agreed in contract" }]) assert.equal(resolve(terms), undefined);
  assert.equal(resolve(split, { dueDate: "2026-10-01" }).toISOString().slice(0, 10), "2026-10-01");
  assert.equal(resolve({ option: "CREDIT_45" }).toISOString().slice(0, 10), "2026-10-16");
  assert.equal(resolve(undefined, { flowType: "B" }).toISOString().slice(0, 10), "2026-09-01");
  assert.equal(resolve(undefined, { flowType: "C" }).toISOString().slice(0, 10), "2026-09-01");
  assert.throws(() => resolve(split, { dueDate: "invalid" }), error => error.statusCode === 422);
});

test("all six quotation terms survive API parsing and produce a useful comparison", () => {
  const fixtures = [
    { paymentCondition: "100%_ADVANCE", paymentNotes: "Start after confirmation" },
    { paymentCondition: "100%_ON_DELIVERY" },
    split,
    { paymentCondition: "CREDIT", creditDays: "75", creditStart: "CONFORMITY" },
    { paymentCondition: "PARTIAL_PAYMENTS", partialPaymentCount: "3", paymentNotes: "30% start, 40% progress, 30% delivery" },
    { paymentCondition: "OTHER", paymentNotes: "Payment after inspection" }
  ];
  for (const terms of fixtures) {
    const [parsed] = parseQuotations(JSON.stringify([{ ...terms, amount: 11800, currency: "PEN" }]));
    assert.equal(parsed.paymentCondition, terms.paymentCondition);
    assert.deepEqual(validatePaymentTerms(parsed), []);
    assert.ok(!paymentTermsSummary(parsed).includes("pending"));
  }
});

test("split amounts sum to the quotation to the cent and ignore forged balances", () => {
  assert.deepEqual(paymentBreakdown(split, 3540), { advancePercentage: 30, balancePercentage: 70, advanceAmount: 1062, balanceAmount: 2478 });
  const [parsed] = parseQuotations([{ ...split, balancePercentage: 99, advanceAmount: 1, balanceAmount: 1 }]);
  assert.equal(parsed.balancePercentage, 70);
  assert.equal(parsed.advanceAmount, undefined);
  assert.deepEqual(paymentBreakdown(parsed, 11800), { advancePercentage: 30, balancePercentage: 70, advanceAmount: 3540, balanceAmount: 8260 });
  assert.equal(paymentBreakdown({ ...split, advancePercentage: 50 }, "0.01").balanceAmount, 0);
  assert.equal(paymentBreakdown({ ...split, advancePercentage: 50 }, "10.075").advanceAmount, 5.04);
  const decimal = paymentBreakdown({ ...split, advancePercentage: 33.33 }, 100.01);
  assert.equal(Math.round((decimal.advanceAmount + decimal.balanceAmount) * 100), 10001);
  assert.equal(paymentBreakdown(split, ""), null);
  assert.equal(paymentBreakdown({ ...split, advancePercentage: "" }, 11800), null);
  assert.match(paymentTermsSummary(split), /30% advance \+ 70% balance/);
});

test("fixed payment cards derive 100/0 and 0/100 through API, model and order snapshots", async () => {
  for (const [paymentCondition, advancePercentage, balancePercentage] of [["100%_ADVANCE", 100, 0], ["100%_ON_DELIVERY", 0, 100]]) {
    const [parsed] = parseQuotations([{ paymentCondition, amount: 3540, currency: "PEN", advancePercentage: 50, balancePercentage: 50, partialPaymentCount: 3, creditDays: 30 }]);
    assert.equal(parsed.advancePercentage, advancePercentage);
    assert.equal(parsed.balancePercentage, balancePercentage);
    assert.equal(parsed.partialPaymentCount, null);
    assert.equal(parsed.creditDays, null);
    assert.deepEqual(validatePaymentTerms(parsed), []);
    const expected = { advancePercentage, balancePercentage, advanceAmount: advancePercentage ? 3540 : 0, balanceAmount: balancePercentage ? 3540 : 0 };
    assert.deepEqual(paymentBreakdown(parsed), expected);
    assert.deepEqual(paymentBreakdown({ paymentCondition, amount: 3540 }), expected, "Historical fixed terms need no migration to display correctly");
    const request = new FinancialRequest({ quotations: [parsed] });
    await request.quotations[0].validate();
    const reloaded = new FinancialRequest(request.toObject());
    assert.equal(reloaded.quotations[0].advancePercentage, advancePercentage);
    assert.equal(reloaded.quotations[0].balancePercentage, balancePercentage);
    const snapshot = selectedQuotationPaymentTerms({ supplier: "supplier", quotations: [{ ...parsed, supplier: "supplier", recommended: true }] });
    assert.equal(snapshot.advancePercentage, advancePercentage);
    assert.equal(snapshot.balancePercentage, balancePercentage);
  }
});

test("API rejects invalid active fields but permits incomplete draft terms", () => {
  for (const value of [-1, 0, 100, 101, 30.001, "NaN", Infinity, true, [], {}]) {
    assert.throws(() => parseQuotations([{ ...split, advancePercentage: value }]), (error) => error.statusCode === 422);
  }
  for (const creditDays of [0, -1, 1.5, "tomorrow", true]) assert.throws(() => parseQuotations([{ paymentCondition: "CREDIT", creditDays }]));
  for (const partialPaymentCount of [0, 1, 2.5]) assert.throws(() => parseQuotations([{ paymentCondition: "PARTIAL_PAYMENTS", partialPaymentCount }]));
  assert.throws(() => parseQuotations([{ paymentCondition: "BAD" }]));
  assert.throws(() => parseQuotations([null]));
  const [draft] = parseQuotations([{ paymentCondition: "ADVANCE_AND_BALANCE" }]);
  assert.equal(draft.advancePercentage, null);
  const submitted = validateStructuredQuotationComparison({ quotations: [draft] }, { enabled: false });
  assert.equal(submitted.valid, false);
  assert.ok(submitted.errors.some((error) => error.field === "advancePercentage" && error.quotation === 1));
  for (const terms of [
    { paymentCondition: "OTHER" },
    { paymentCondition: "PARTIAL_PAYMENTS", partialPaymentCount: 3 },
    { ...split, balanceTiming: "OTHER" },
    { paymentCondition: "CREDIT", creditDays: 30 }
  ]) assert.ok(validatePaymentTerms(terms).length);
});

test("switching term types clears inactive data and retains legacy text without guessing terms", () => {
  const switched = normalizePaymentTerms({ ...split, paymentCondition: "CREDIT", creditDays: 45, creditStart: "INVOICE", balanceTimingNotes: "obsolete", partialPaymentCount: 3 });
  assert.equal(switched.advancePercentage, null);
  assert.equal(switched.balancePercentage, null);
  assert.equal(switched.balanceTiming, null);
  assert.equal(switched.balanceTimingNotes, "");
  assert.equal(switched.partialPaymentCount, null);
  const [legacy] = parseQuotations([{ paymentConditions: "Según contrato original" }]);
  assert.equal(paymentTermsSummary(legacy), "Según contrato original");
  assert.equal(legacy.paymentCondition, null);
  assert.deepEqual(validatePaymentTerms(legacy), []);
  assert.equal(paymentTermsSummary({}), "Not specified");
});

test("quotation model enforces percentage validation and recalculates derived balance", async () => {
  const request = new FinancialRequest({ quotations: [{ ...split, balancePercentage: 99 }] });
  await request.quotations[0].validate();
  assert.equal(request.quotations[0].balancePercentage, 70);
  request.quotations[0].advancePercentage = 150;
  await assert.rejects(() => request.quotations[0].validate(), /advance/);
});

test("order terms come only from the recommended quotation for the selected supplier", () => {
  const request = { supplier: { _id: "chosen" }, currency: "USD", quotations: [
    { supplier: "other", ...split, recommended: false },
    { supplier: { _id: "chosen" }, paymentCondition: "CREDIT", creditDays: 60, creditStart: "INVOICE", amount: 120, currency: "USD", recommended: true }
  ] };
  const snapshot = selectedQuotationPaymentTerms(request);
  assert.equal(snapshot.paymentCondition, "CREDIT");
  assert.equal(snapshot.creditDays, 60);
  assert.equal(snapshot.quotationAmount, 120);
  request.quotations[1].creditDays = 15;
  assert.equal(snapshot.creditDays, 60);
  request.supplier = "wrong";
  assert.throws(() => selectedQuotationPaymentTerms(request), /match the order supplier/);
  assert.equal(selectedQuotationPaymentTerms({ quotations: [] }), undefined);
});
