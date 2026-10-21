import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { accountingLines, emptyRow, igvSplit, renditionPayload, renditionTotals, rowProblems, rowsFromRendition, transportDaysOverLimit } from "../src/utils/simpleRendition.js";

// The translator lives in a .jsx module: bundle it for Node, as tones.test.js does.
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL("../src/context/LanguageContext.jsx", import.meta.url))], bundle: true, format: "esm", platform: "node", external: ["react", "react-router-dom", "react/jsx-runtime"], jsx: "automatic", write: false, logLevel: "silent" });
const bundleFile = path.join(fileURLToPath(new URL(".", import.meta.url)), `.language-rendition-${process.pid}.mjs`);
fs.writeFileSync(bundleFile, bundle.outputFiles[0].text);
let translateMessage;
try { ({ translateMessage } = await import(pathToFileURL(bundleFile).href)); } finally { fs.unlinkSync(bundleFile); }

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const row = (kind, patch) => ({ ...emptyRow(kind, "2026-10-20"), ...patch });

// 1. Money: the rendition is sent when advance - spent - returned = 0.
const receipt = row("RECEIPT", { documentType: "BOLETA", description: "Lunch", amount: "30", file: { name: "boleta.jpg" } });
const factura = row("RECEIPT", { documentType: "FACTURA", description: "Bus tickets", amount: "11.80", file: { name: "factura.xml" } });
const taxi = row("TRANSPORT", { origin: "UMA", destination: "Colegio", amount: "10" });
const tip = row("NO_RECEIPT", { description: "Parking", amount: "2" });
assert.deepEqual(renditionTotals({ rows: [receipt, factura, taxi, tip], advanced: 56, returned: "2.20" }), { advanced: 56, spent: 53.8, returned: 2.2, balance: 0 });
assert.equal(renditionTotals({ rows: [receipt], advanced: 56, returned: "" }).balance, 26);

// 2. A factura's amount includes 18% IGV; other receipts carry none. One accounting line on the CECO.
assert.deepEqual(igvSplit(factura), { net: 10, igv: 1.8, total: 11.8 });
assert.deepEqual(igvSplit(receipt), { net: 30, igv: 0, total: 30 });
assert.deepEqual(accountingLines([receipt, factura, taxi, tip], "cc1"), [{ costCenter: "cc1", netAmount: 52, igvAmount: 1.8, totalAmount: 53.8 }]);
assert.deepEqual(accountingLines([], "cc1"), []);

// 3. What is missing, in plain words.
assert.deepEqual(rowProblems(row("RECEIPT", { amount: "" })), ["the amount", "what it was for", "the photo or PDF of the receipt"]);
assert.deepEqual(rowProblems(row("TRANSPORT", { amount: "5" })), ["where you went from", "where you went to"]);
assert.deepEqual(rowProblems({ ...receipt, documentType: "FACTURA", issuerRuc: "123" }), ["an 11-digit RUC"]);
assert.deepEqual(rowProblems(receipt), []);
assert.deepEqual(rowProblems({ ...receipt, file: null, attachment: "att1" }), [], "a receipt already attached needs no new file");

// 4. The payload: receipt files first, each receipt line pointing at its file; the rest map to
// the existing transport and no-receipt lines.
const payload = renditionPayload({ rows: [receipt, taxi, factura, tip, { ...row("RECEIPT", { description: "Kept", amount: "1" }), attachment: "att1" }], returned: "1.2", costCenter: "cc1", purpose: "Trip" });
assert.deepEqual(payload.files.map((file) => file.name), ["boleta.jpg", "factura.xml"]);
assert.deepEqual(payload.receiptLines.map((line) => [line.description, line.fileIndex, line.attachment]), [["Lunch", 0, undefined], ["Bus tickets", 1, undefined], ["Kept", undefined, "att1"]]);
assert.deepEqual(payload.mobilityLines, [{ date: "2026-10-20", origin: "UMA", destination: "Colegio", servicePurpose: "Trip", amount: 10 }]);
assert.deepEqual(payload.unsupportedExpenseLines, [{ date: "2026-10-20", description: "Parking", goodsServiceType: "SERVICES", grossAmount: 2 }]);
assert.equal(payload.amountReturned, 1.2);

// 5. After Accounting sends it back, the saved rows come back to the form.
const restored = rowsFromRendition({ receiptLines: [{ date: "2026-10-20T05:00:00.000Z", documentType: "FACTURA", description: "Bus", amount: 11.8, attachment: "a1" }], mobilityLines: [{ date: "2026-10-21", origin: "A", destination: "B", servicePurpose: "Trip", amount: 5 }], unsupportedExpenseLines: [{ date: "2026-10-21", description: "Tip", grossAmount: 1 }] });
assert.deepEqual(restored.map((item) => [item.kind, item.date, item.amount, item.attachment]), [["RECEIPT", "2026-10-20", "11.8", "a1"], ["TRANSPORT", "2026-10-21", "5", null], ["NO_RECEIPT", "2026-10-21", "1", null]]);
assert.deepEqual(transportDaysOverLimit([taxi, { ...taxi, amount: "15" }], 20), ["2026-10-20"]);
assert.deepEqual(transportDaysOverLimit([taxi], 0), [], "no limit configured");

// 6. The request page: the employee's paid advance gets the card, three tabs and the simple form.
const detail = source("../src/pages/RequestDetail.jsx");
assert.match(detail, /const simpleAdvance = isOwner && request\.flowType === "C" && request\.requestType === "ENTREGA_RENDIR" && RENDITION_STAGES\.includes/);
assert.match(detail, /simpleAdvance \? <AdvanceRenditionCard request=\{request\} onOpen=\{openReceipts\} \/>/);
assert.match(detail, /\{ id: "General", label: "Summary"[^}]*\}, \{ id: "Documents", label: "Receipts"[^}]*\}, \{ id: "Approvals", label: "History"/);
assert.match(detail, /<Section skip=\{simpleAdvance\} title="Documents and fiscal validation"/, "no invoice validation or document phases for the employee's advance");
assert.match(detail, /\{!simpleAdvance && <div hidden=\{activeTab !== "Documents"\}><FinancialValidationSummary/);
assert.match(detail, /<SimpleRenditionForm request=\{request\} onReload=\{load\} \/>/);
// "Repeat this request" was removed from the request page.
assert.doesNotMatch(detail, /Repeat this request|\/requests\/new\?from=/, "no Repeat action");
const form = source("../src/components/rendition/SimpleRenditionForm.jsx");
assert.match(form, /api\.post\("\/requests\/invoice-preview"/, "a factura XML or PDF fills the row");
assert.match(form, /data\.append\("returnReceipt", slip\)/);
assert.match(form, /data\.append\("beneficiaryAcknowledged", "true"\)/, "the acknowledgement is the confirmation dialog");
assert.match(source("../src/components/rendition/OfficialRenditionWorkspace.jsx"), /title="Receipts"/, "Accounting sees the receipts");

// 7. Labels stored in Spanish read in English on the English page; English keys stay as they are.
assert.equal(translateMessage("documentos de sustento de rendición", "en"), "rendition supporting documents");
assert.equal(translateMessage("rendition supporting documents", "es"), "documentos de sustento de rendición");
assert.equal(translateMessage("Total", "en"), "Total");
assert.equal(translateMessage("Some text nobody translated", "en"), "Some text nobody translated");

console.log("PASS simple rendition: totals, IGV split, payload, problems, page wiring, Spanish labels in English");
