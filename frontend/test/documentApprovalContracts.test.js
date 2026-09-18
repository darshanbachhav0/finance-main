import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const detail = read("../src/pages/RequestDetail.jsx");
const create = read("../src/pages/RequestCreate.jsx");
const configuration = read("../src/pages/MasterConfiguration.jsx");

for (const phase of ["SUBMISSION", "PROCUREMENT", "INVOICE_REGISTRATION", "ACCOUNTING", "RENDITION"]) assert.ok(detail.includes(phase));
assert.ok(detail.includes("Current document phase"));
assert.ok(detail.includes("phaseStatus.requirements") && detail.includes("phaseStatus.missing"));
assert.ok(detail.includes("/document-requirements"));
assert.ok(detail.includes("FEE_RECEIPT") && create.includes("FEE_RECEIPT"));
assert.ok(configuration.includes('name: "flowType"') && configuration.includes('name: "phase"'));
assert.ok(configuration.includes("documentPhases"));
console.log("PASS document workflow UI: current phase, required/uploaded/missing evidence, fee receipts, and configurable track/phase rules");
