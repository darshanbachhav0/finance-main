import assert from "node:assert/strict";
import fs from "node:fs";
import { clientId, withSafeQuotationIds } from "../src/utils/clientId.js";
import { lineFromInvoice } from "../src/utils/invoiceAutofill.js";
import { sanitizeInput } from "../../backend/src/middleware/sanitizeInput.js";

// The API refuses any field name with "." or "$" (NoSQL injection guard). A request draft keys its
// quotation files by the quotation's clientId, so those ids must be safe field names.
const accepted = (body) => { try { sanitizeInput({ body, query: {} }, {}, () => {}); return true; } catch { return false; } };
const draft = (quotations, quotationFiles) => ({ scope: "request", recordId: "new", revision: 1, value: { form: {}, lines: [], quotations, quotationFiles } });
const file = { __draftFile: "file-1", name: "cotizacion.pdf", type: "application/pdf" };

// 1. New ids have no dots and do not repeat.
const ids = Array.from({ length: 500 }, clientId);
assert.equal(new Set(ids).size, ids.length, "ids are unique");
assert.deepEqual(ids.filter((id) => /[.$]/.test(id)), [], "no id contains . or $");
assert.doesNotMatch(lineFromInvoice({ totalAmount: 118, netAmount: 100, igvAmount: 18 }).clientId, /[.$]/, "lines read from an invoice too");

// 2. A draft with a quote attached is saved; with the earlier dotted id it was refused.
const id = clientId();
assert.equal(accepted(draft([{ clientId: id, supplier: "s1" }], { [id]: file })), true, "a draft with a quote file is accepted");
const dotted = "1729700000000-0.5381";
assert.equal(accepted(draft([{ clientId: dotted }], { [dotted]: file })), false, "the earlier id is what the API refused");

// 3. A draft kept with dotted ids (in this browser's outbox) is renamed on restore and saves again.
const quotations = [{ clientId: dotted, supplier: "s1", amount: "100" }, { clientId: "64f000000000000000000001", supplier: "s2" }];
const files = { [dotted]: file, "64f000000000000000000001": { ...file, __draftFile: "file-2" }, "1.2": { ...file, __draftFile: "orphan" } };
const restored = withSafeQuotationIds(quotations, files);
assert.equal(accepted(draft(restored.quotations, restored.quotationFiles)), true);
const renamed = restored.quotations[0].clientId;
assert.doesNotMatch(renamed, /[.$]/);
assert.deepEqual(restored.quotations[0], { ...quotations[0], clientId: renamed }, "only the id changes");
assert.equal(restored.quotationFiles[renamed], file, "the quote's file follows its new id");
assert.equal(restored.quotations[1], quotations[1], "a server id is kept as it is");
assert.equal(restored.quotationFiles["64f000000000000000000001"].__draftFile, "file-2");
assert.equal(Object.keys(restored.quotationFiles).length, 2, "a dotted key with no quotation is dropped");
assert.equal(quotations[0].clientId, dotted, "the restored draft is not mutated");
assert.deepEqual(withSafeQuotationIds(), { quotations: [], quotationFiles: {} });

// 4. The request form uses these ids and renames old ones when it restores a draft.
const page = fs.readFileSync(new URL("../src/pages/RequestCreate.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.match(page, /const emptyQuotation = \(\) => \(\{\n  clientId: clientId\(\),/);
assert.match(page, /const emptyLine = \(costCenter = ""\) => \(\{\n  clientId: clientId\(\),/);
assert.match(page, /withSafeQuotationIds\(data\.quotations \|\| \[\], data\.quotationFiles \|\| \{\}\)/);
assert.doesNotMatch(page, /Math\.random\(\)\}`/, "no dotted template ids left in the form");

console.log("PASS request draft keys: quote ids are safe field names, a draft with a quote saves, older dotted drafts are renamed on restore");
