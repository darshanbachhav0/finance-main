import assert from "node:assert/strict";
import test from "node:test";
import FinancialRequest from "../src/models/FinancialRequest.js";
import { parseQuotations } from "../src/services/requestService.js";
import { validateStructuredQuotationComparison } from "../src/services/documentRuleService.js";
import { selectedQuotationPaymentTerms } from "../src/services/purchaseOrderService.js";
import { normalizePaymentTerms, paymentBreakdown, paymentTermsSummary, validatePaymentTerms } from "../../shared/paymentTerms.mjs";

const split = { paymentCondition: "ADVANCE_AND_BALANCE", advancePercentage: 30, balanceTiming: "ON_DELIVERY" };

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
