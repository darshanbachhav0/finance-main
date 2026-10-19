import assert from "node:assert/strict";
import test from "node:test";
import { assertMandatoryDocuments, assertRequestLines, requiredDocumentsFor } from "../src/services/requestRules.js";
import { MANDATORY_XML_TYPES } from "../src/utils/constants.js";

test("A1 and B are sent with a quote, the invoice, or both - at least one", () => {
  for (const flowType of ["A1", "B"]) {
    const request = { flowType, requestType: MANDATORY_XML_TYPES[0], attachments: [] };
    assert.throws(() => assertMandatoryDocuments(request), (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /a quote or the invoice/);
      return true;
    });
    for (const attachments of [[{ kind: "XML" }], [{ kind: "PDF" }], [{ kind: "QUOTATION" }], [{ kind: "QUOTATION" }, { kind: "XML" }]]) {
      assert.doesNotThrow(() => assertMandatoryDocuments({ flowType, requestType: MANDATORY_XML_TYPES[0], attachments }), `${flowType}: ${attachments.map((item) => item.kind)}`);
    }
    assert.throws(() => assertMandatoryDocuments({ flowType, requestType: MANDATORY_XML_TYPES[0], attachments: [{ kind: "CONTRACT" }] }), "a contract alone is neither a quote nor the invoice");
  }
});

test("a stored invoice XML missing from disk is a clear 422, never a server error", async () => {
  const { parseInvoiceXml, fileChecksum } = await import("../src/services/xmlValidationService.js");
  for (const read of [parseInvoiceXml, fileChecksum]) {
    await assert.rejects(() => read("/tmp/uma-finance/uploads/requests/missing/gone.xml"), (error) => error.statusCode === 422 && error.code === "STORED_FILE_MISSING" && /Upload it again/.test(error.message));
  }
});

test("Track C submission can be saved without invoice files", () => {
  assert.doesNotThrow(() => assertMandatoryDocuments({ flowType: "C", requestType: "ENTREGA_RENDIR", attachments: [] }));
});

test("every request needs at least one line with a Cost Center; requesters never choose an account", () => {
  assert.throws(() => assertRequestLines([]), (error) => error.statusCode === 422);
  assert.throws(
    () => assertRequestLines([{ expenseType: "expense-1" }]),
    (error) => error.statusCode === 422 && /Cost Center/.test(error.message)
  );
  assert.doesNotThrow(() => assertRequestLines([{ costCenter: "cost-1" }]));
});

test("goods and services alike: one rule at submission, invoice documents stay in the invoice phase", () => {
  for (const expenseNature of ["Compra de Bienes", "Contratación de Servicios"]) {
    const request = { requestType: "CAPEX", expenseNature, attachments: [] };
    assert.deepEqual(requiredDocumentsFor(request).map((rule) => [rule.kind, rule.min]), [["QUOTE_OR_INVOICE", 1]]);
    assert.throws(() => assertMandatoryDocuments(request), (error) => error.statusCode === 422 && /a quote or the invoice/.test(error.message));
    assert.doesNotThrow(() => assertMandatoryDocuments({ ...request, attachments: [{ kind: "QUOTATION" }] }));
    assert.doesNotThrow(() => assertMandatoryDocuments({ ...request, attachments: [{ kind: "PDF" }] }));
  }
});
