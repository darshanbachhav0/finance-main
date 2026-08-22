import assert from "node:assert/strict";
import test from "node:test";
import { assertMandatoryDocuments, assertRequestLines, requiredDocumentsFor } from "../src/services/requestRules.js";
import { MANDATORY_XML_TYPES } from "../src/utils/constants.js";

test("mandatory invoice request types require both XML and PDF", () => {
  const request = { requestType: MANDATORY_XML_TYPES[0], attachments: [{ kind: "XML" }] };
  assert.throws(() => assertMandatoryDocuments(request), (error) => {
    assert.equal(error.statusCode, 422);
    assert.match(error.message, /PDF/);
    return true;
  });

  assert.doesNotThrow(() => assertMandatoryDocuments({
    requestType: MANDATORY_XML_TYPES[0],
    attachments: [{ kind: "XML" }, { kind: "PDF" }]
  }));
});

test("request types outside the mandatory XML list can be saved without invoice files", () => {
  assert.doesNotThrow(() => assertMandatoryDocuments({ requestType: "OPEX", attachments: [] }));
});

test("every request needs at least one fully dimensioned accounting line", () => {
  assert.throws(() => assertRequestLines([]), (error) => error.statusCode === 422);
  assert.throws(
    () => assertRequestLines([{ costCenter: "cost-1" }]),
    (error) => error.statusCode === 422 && /Expense Type/.test(error.message)
  );
  assert.doesNotThrow(() => assertRequestLines([{ costCenter: "cost-1", expenseType: "expense-1" }]));
});

test("goods purchases require three quotations and an invoice document", () => {
  const request = { requestType: "CAPEX", expenseNature: "Compra de Bienes", attachments: [{ kind: "PDF" }, { kind: "QUOTATION" }, { kind: "QUOTATION" }] };
  assert.deepEqual(requiredDocumentsFor(request).map((rule) => [rule.kind, rule.min]), [["QUOTATION", 3], ["PDF", 1]]);
  assert.throws(() => assertMandatoryDocuments(request), (error) => error.statusCode === 422 && /three quotations/.test(error.message));
  request.attachments.push({ kind: "QUOTATION" });
  assert.doesNotThrow(() => assertMandatoryDocuments(request));
});

test("service requests require invoice, signed contract, and conformity report", () => {
  const request = { requestType: "OPEX", expenseNature: "Contratación de Servicios", attachments: [{ kind: "PDF" }, { kind: "CONTRACT" }, { kind: "CONFORMITY" }] };
  assert.doesNotThrow(() => assertMandatoryDocuments(request));
});
