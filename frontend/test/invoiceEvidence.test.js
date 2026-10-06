import assert from "node:assert/strict";
import fs from "node:fs";
import { coversKind, isEitherOf, presentCount, requirementKinds, ruleForKind } from "../src/utils/documentRequirements.js";

// The invoice is evidenced by its XML or its factura PDF: one is enough (backend documentRuleService).
const invoice = { kind: "INVOICE", anyOf: ["XML", "PDF"], minCount: 1, labelKey: "invoice XML or factura PDF" };
const conformity = { kind: "CONFORMITY", minCount: 1, labelKey: "service conformity" };
assert.deepEqual(requirementKinds(invoice), ["XML", "PDF"]);
assert.deepEqual(requirementKinds(conformity), ["CONFORMITY"]);
assert.ok(coversKind(invoice, "XML") && coversKind(invoice, "PDF") && !coversKind(invoice, "CONFORMITY"));
assert.equal(ruleForKind([conformity, invoice], "PDF"), invoice);
assert.equal(ruleForKind([conformity], "PDF"), undefined);
assert.equal(presentCount(invoice, [{ kind: "PDF" }]), 1, "a stored factura PDF counts");
assert.equal(presentCount(invoice, [], { XML: 1 }), 1, "an XML chosen in the form counts");
assert.equal(presentCount(conformity, [{ kind: "PDF" }]), 0);
assert.ok(isEitherOf(invoice) && !isEitherOf(conformity));

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const create = read("../src/pages/RequestCreate.jsx");
const detail = read("../src/pages/RequestDetail.jsx");
// New request (Track B): each invoice card says the other file also does, and the step accepts either.
assert.match(create, /ruleForKind\(formPolicy\.documentRequirements, document\.kind\)/);
assert.match(create, /presentCount\(rule, existingAttachments/);
assert.match(create, /Required: this or \{other\}/);
assert.doesNotMatch(create, /mandatory XML \+ PDF/);
// Request page: evidence counts either file; the A1 invoice form asks for one of them.
assert.match(detail, /presentCount\(rule, attachments\)/);
assert.match(detail, /invoiceRequirements\.some\(\(item\) => coversKind\(item, field\.kind\)\)/);
assert.match(detail, /required=\{!invoiceFiles\[field\.key\] && !chosenElsewhere\}/);
assert.match(detail, /source === "PDF" \? "Invoice verified from the factura PDF"/);

console.log("PASS invoice evidence: the invoice XML or its factura PDF satisfies the requirement in the request form and the request page");
