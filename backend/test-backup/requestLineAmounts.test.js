import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { calculateRequestLineAmounts as calculate } from "../../shared/requestLineAmounts.mjs";
import { editRequestLine, restoreEditorLine } from "../../frontend/src/utils/requestLineEditor.js";
import { parseRequestLines } from "../src/services/requestService.js";
import FinancialRequest from "../src/models/FinancialRequest.js";
import { assertRequestLines } from "../src/services/requestRules.js";

const input = { quantity: 3, unitPrice: 1000, priceIncludesIGV: true };
const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
function request(lines) {
  return new FinancialRequest({ requestNumber: "SOL-2026-90001", issueDate: "2026-09-09", accountingPeriod: "2026-09", requestType: "OPEX", expenseNature: "GOODS", currency: "PEN", supplier: ids[0], solicitor: ids[1], description: "Automatic item totals", lines: lines.map(line => ({ costCenter: ids[2], expenseType: ids[3], itemDescription: "Supplies", unitOfMeasure: "UNIT", ...line })) });
}

test("IGV included: 3 x 1000 stays 3000 with an exact net/tax split", () => {
  assert.deepEqual(calculate(input), { unitPrice: 1000, subtotal: 3000, netAmount: 2542.37, igvAmount: 457.63, totalAmount: 3000 });
});
test("IGV excluded: 3 x 1000 adds 540 and totals 3540", () => {
  assert.deepEqual(calculate({ ...input, priceIncludesIGV: false }), { unitPrice: 1000, subtotal: 3000, netAmount: 3000, igvAmount: 540, totalAmount: 3540 });
});
test("fractional quantities and half-cent rounding reconcile to the cent", () => {
  assert.equal(calculate({ ...input, quantity: 0.00000001, unitPrice: 1000000 }).totalAmount, 0.01);
  assert.equal(calculate({ ...input, quantity: "0.5", unitPrice: "0.01" }).totalAmount, 0.01);
  assert.deepEqual(calculate({ ...input, quantity: "2.5", unitPrice: "19.99", priceIncludesIGV: false }), { unitPrice: 19.99, subtotal: 49.98, netAmount: 49.98, igvAmount: 9, totalAmount: 58.98 });
  for (let cents = 1; cents < 500; cents++) {
    for (const priceIncludesIGV of [true, false]) {
      const result = calculate({ quantity: 3, unitPrice: cents / 100, priceIncludesIGV });
      assert.equal(Math.round(result.netAmount * 100) + Math.round(result.igvAmount * 100), Math.round(result.totalAmount * 100));
    }
  }
});
test("invalid inputs and non-boolean tax options are rejected", () => {
  for (const patch of [{ quantity: -1 }, { unitPrice: "" }, { unitPrice: Infinity }, { unitPrice: "abc" }, { unitPrice: "99999999999999999999" }, { quantity: "0.000000001" }, { quantity: 1e-9 }, { priceIncludesIGV: "false" }, { priceIncludesIGV: null }]) assert.throws(() => calculate({ ...input, ...patch }));
});
test("editing quantity, price and IGV recalculates immediately; an empty price clears old totals", () => {
  let line = restoreEditorLine({ ...input, ...calculate(input) });
  line = editRequestLine(line, { quantity: "4" });
  assert.equal(line.totalAmount, 4000);
  line = editRequestLine(line, { unitPrice: "500" });
  assert.equal(line.totalAmount, 2000);
  line = editRequestLine(line, { priceIncludesIGV: false });
  assert.equal(line.totalAmount, 2360);
  line = editRequestLine(line, { unitPrice: "" });
  assert.equal(line.totalAmount, 0);
  assert.ok(line.calculationError);
});
test("legacy amounts are inferred only when consistent and otherwise remain unchanged", () => {
  const legacy = { quantity: 1, unitPrice: 118, netAmount: 100, igvAmount: 18, totalAmount: 118 };
  assert.equal(restoreEditorLine(legacy).priceIncludesIGV, true);
  assert.equal(restoreEditorLine({ ...legacy, unitPrice: 100 }).priceIncludesIGV, false);
  const exempt = restoreEditorLine({ ...legacy, netAmount: 118, igvAmount: 0 });
  assert.equal(exempt.legacyAmounts, true);
  assert.equal(editRequestLine(exempt, { itemDescription: "Updated name" }).igvAmount, 0);
  assert.equal(editRequestLine(exempt, { priceIncludesIGV: true }).igvAmount, 18);
});
test("API input ignores tampered amounts for automatic lines and validates the tax option", () => {
  const [line] = parseRequestLines([{ ...input, costCenter: ids[2], expenseType: ids[3], netAmount: 1, igvAmount: 2, totalAmount: 3, commercialTotal: 4 }]);
  assert.equal(line.totalAmount, 3000);
  assert.equal(line.igvAmount, 457.63);
  assert.doesNotThrow(() => assertRequestLines([line]));
  assert.throws(() => parseRequestLines([{ ...input, priceIncludesIGV: "false" }]), error => error.statusCode === 422);
});
test("model revalidation and reload preserve tax basis, gross commercial totals and PEN amounts", async () => {
  const doc = request([{ ...input, priceIncludesIGV: false, netAmount: 1, igvAmount: 0, totalAmount: 1 }]);
  await doc.validate();
  assert.equal(doc.totalAmount, 3540);
  assert.equal(doc.totalCommercialAmount, 3540);
  assert.equal(doc.commercialTotalStatus, "MATCH");
  const restored = new FinancialRequest(doc.toObject());
  restored.lines[0].quantity = 4;
  await restored.validate();
  assert.equal(restored.lines[0].priceIncludesIGV, false);
  assert.equal(restored.totalAmount, 4720);
  assert.equal(restored.totalPENEquivalent, 4720);
  const smallQuantity = request([{ ...input, quantity: 0.00000001, unitPrice: 1000000 }]);
  await smallQuantity.validate();
  assert.equal(smallQuantity.totalAmount, 0.01);
});
test("old documents without the new tax field keep their historical totals", async () => {
  const doc = request([{ quantity: 3, unitPrice: 10.005, netAmount: 30.03, igvAmount: 0, totalAmount: 30.03 }]);
  await doc.validate();
  assert.equal(doc.lines[0].priceIncludesIGV, undefined);
  assert.equal(doc.totalIGV, 0);
  assert.equal(doc.totalAmount, 30.03);
  assert.equal(doc.commercialTotalStatus, "MATCH");
});
