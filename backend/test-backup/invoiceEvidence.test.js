import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { invoiceFieldsFromLines, parseInvoicePdf } from "../src/services/invoicePdfService.js";
import { assertInvoiceEvidencePair, assertReadableVoucher, assertVoucherEvidenceMatches, buildInvoiceValidationResult, latestInvoiceEvidence, parseInvoiceEvidence, parseInvoiceXml } from "../src/services/xmlValidationService.js";
import SunatVoucher from "../src/models/SunatVoucher.js";
import { findDuplicateVoucher } from "../src/services/sunatVoucherService.js";
import { tempUploadDir } from "../src/services/storageService.js";
import { invoicePdf, invoiceXml, textPdf } from "./fiscalFixtures.js";

const voucher = { ruc: "20512345678", series: "F001", number: "00000123", issueDate: "2026-10-05", currency: "PEN", netAmount: 1000, igvAmount: 180, totalAmount: 1180 };
const files = [];
async function stored(name, content) {
  await fs.mkdir(tempUploadDir, { recursive: true });
  const filePath = path.join(tempUploadDir, `evidence-${process.pid}-${name}`);
  await fs.writeFile(filePath, content);
  files.push(filePath);
  return filePath;
}
test.after(() => Promise.all(files.map((file) => fs.rm(file, { force: true }))));

test("a supplier's printed factura gives the same invoice data as its XML", async () => {
  const fromXml = await parseInvoiceXml(await stored("invoice.xml", invoiceXml(voucher)));
  const { source, data } = await parseInvoiceEvidence(await stored("invoice.pdf", invoicePdf(voucher)));
  assert.equal(source, "PDF");
  for (const field of ["ruc", "invoiceNumber", "documentTypeCode", "voucherType", "issueDate", "currency", "netAmount", "igvAmount", "totalAmount"]) {
    assert.equal(data[field], fromXml[field], field);
  }
  // The file's bytes decide how it is read, not its name.
  assert.equal((await parseInvoiceEvidence(await stored("named-like-xml.xml", invoicePdf(voucher)))).source, "PDF");
  assert.equal((await parseInvoiceEvidence(await stored("plain.xml", invoiceXml(voucher)))).source, "XML");
});

test("the factura reader handles the usual printed layouts", () => {
  // Buyer printed before the issuer, US dollars, European decimals, an item table whose "Total"
  // column header has no amount beside it, and "TOTAL A PAGAR".
  assert.deepEqual(invoiceFieldsFromLines([
    "CLIENTE: UNIVERSIDAD MARIA AUXILIADORA", "RUC: 20100000001",
    "SOFTWARE ANDINO S.A.C. RUC 20512345678", "FACTURA ELECTRONICA F002-458",
    "FECHA DE EMISION 2026-09-30", "MONEDA: DOLARES AMERICANOS",
    "DESCRIPCION CANT TOTAL", "Licencia anual 1 1.000,00",
    "SUB TOTAL 1.000,00", "IGV (18%) 180,00", "TOTAL A PAGAR US$ 1.180,00"
  ]), { ruc: "20512345678", supplierName: "", invoiceNumber: "F002-458", documentTypeCode: "01", voucherType: "FACTURA", issueDate: "2026-09-30", currency: "USD", netAmount: 1000, igvAmount: 180, totalAmount: 1180 });

  const exonerated = invoiceFieldsFromLines(["LIBRERIA SAC", "RUC 20512345678", "FACTURA ELECTRONICA", "F001-9", "Fecha de emisión: 01/10/2026", "Moneda: Soles", "OP. EXONERADA S/ 500.00", "IMPORTE TOTAL S/ 500.00"]);
  assert.deepEqual([exonerated.netAmount, exonerated.igvAmount, exonerated.totalAmount], [500, 0, 500], "no IGV line on an exonerated factura means zero IGV");

  const boleta = invoiceFieldsFromLines(["RUC 20512345678", "BOLETA DE VENTA ELECTRONICA", "B001-77", "Fecha de emisión: 02/10/2026", "SOLES", "OP. GRAVADA 50.00", "IGV 9.00", "TOTAL 59.00"]);
  assert.deepEqual([boleta.voucherType, boleta.invoiceNumber, boleta.totalAmount], ["BOLETA", "B001-77", 59]);

  const fees = invoiceFieldsFromLines(["RECIBO POR HONORARIOS ELECTRONICO", "E001-12", "RUC: 10456789012", "Fecha de emisión: 15 de setiembre del 2026", "Moneda: SOLES", "TOTAL POR HONORARIOS: 2,000.00", "RETENCION (8%) IR: 160.00", "TOTAL NETO RECIBIDO: 1,840.00"]);
  assert.deepEqual([fees.voucherType, fees.invoiceNumber, fees.issueDate, fees.netAmount, fees.igvAmount, fees.totalAmount], ["RXH", "E001-12", "2026-09-15", 2000, 0, 2000]);

  // Labels in a header row with their values underneath, the currency as the singular "Sol", and
  // every text fragment drawn twice (as pdf.js reads Total Networks' factura F001-00015597).
  assert.deepEqual(invoiceFieldsFromLines([
    "Total Networks S.A Total Networks S.A", "F001-00015597", "RUC: 20601694680 RUC: 20601694680", "Factura electrónica Factura electrónica",
    "Razón social: Razón social:", "UNIVERSIDAD MARIA AUXILIADORA S.A.C.", "RUC RUC 20550807123",
    "Fecha de Factura: Fecha de Factura: Fecha de vencimiento: Fecha de vencimiento: Tipo de moneda: Tipo de moneda: Forma de pago: Forma de pago:",
    "10/10/2026 31/10/2026 Sol Credito",
    "Cantidad Descripción Precio unitario Impuestos Importe", "1 Internet Business+ 200Mbps 441.00 IGV S/ 373.73",
    "Subtotal S/ 373.73", "IGV S/ 67.27", "Número de factura : F001-00015597 F001-00015597", "Total Total S/ S/ 441.00 441.00",
    "Monto a pagar: S/ 441.00 Cuota: 01 Codigo de cliente: 10135"
  ], { expectedRuc: "20601694680" }), { ruc: "20601694680", supplierName: "", invoiceNumber: "F001-00015597", documentTypeCode: "01", voucherType: "FACTURA", issueDate: "2026-10-10", currency: "PEN", netAmount: 373.73, igvAmount: 67.27, totalAmount: 441 });
  // A currency label whose neighbourhood names none still reads the amounts' own symbol.
  assert.equal(invoiceFieldsFromLines(["RUC 20512345678", "FACTURA F001-5", "Moneda:", "Fecha 01/10/2026", "TOTAL S/ 118.00"]).currency, "PEN");
  assert.equal(invoiceFieldsFromLines(["RUC 20512345678", "FACTURA F001-6", "Tipo de moneda:", "Dólares americanos", "TOTAL 118.00"]).currency, "USD");

  // When the request's supplier RUC is printed as a non-buyer RUC, it is taken as the issuer.
  assert.equal(invoiceFieldsFromLines(["Grupo SAC RUC 20999999991", "Emisor: RUC 20512345678", "FACTURA F001-1"], { expectedRuc: "20512345678" }).ruc, "20512345678");
});

test("a scanned or broken PDF is reported as unreadable, never guessed", async () => {
  await assert.rejects(() => parseInvoicePdf(textPdf([])), (error) => error.code === "INVOICE_PDF_UNREADABLE" && /XML/.test(error.message));
  await assert.rejects(() => parseInvoicePdf(Buffer.from("%PDF-1.4 not really a pdf")), (error) => error.code === "INVOICE_PDF_UNREADABLE");
  assert.throws(() => assertReadableVoucher({ ruc: "20512345678", currency: "PEN" }, "PDF"), (error) => error.code === "INVOICE_PDF_UNREADABLE" && /series and number, issue date, total amount/.test(error.message));
  assert.doesNotThrow(() => assertReadableVoucher({}, "XML"), "an XML is never held to the PDF rule");
});

test("the request is verified from the factura PDF exactly as from an XML", async () => {
  const filePath = await stored("verify.pdf", invoicePdf(voucher));
  const request = { supplier: { rucDni: voucher.ruc }, currency: "PEN", totalNet: 1000, totalIGV: 180, totalAmount: 1180, issueDate: "2026-10-05" };
  const valid = await buildInvoiceValidationResult(filePath, request);
  assert.equal(valid.validated, true, JSON.stringify(valid.errors));
  assert.equal(valid.source, "PDF");
  assert.equal(valid.provider, "LOCAL_PDF");
  const wrong = await buildInvoiceValidationResult(filePath, { ...request, totalAmount: 1190, supplier: { rucDni: "20999999991" } });
  assert.equal(wrong.validated, false);
  assert.ok(wrong.errors.some((error) => /Total amount does not match the factura PDF/.test(error)), JSON.stringify(wrong.errors));
  assert.ok(wrong.errors.some((error) => /Supplier RUC\/DNI does not match the factura PDF/.test(error)));
  // Each difference also comes structured, so the screen can list expected vs found per field.
  assert.deepEqual(wrong.mismatches, [
    { field: "supplier", expected: "20999999991", found: voucher.ruc },
    { field: "totalAmount", expected: 1190, found: 1180 }
  ]);
  assert.deepEqual(valid.mismatches, []);
  const dollars = await buildInvoiceValidationResult(filePath, { ...request, currency: "USD" });
  assert.deepEqual(dollars.mismatches, [{ field: "currency", expected: "USD", found: "PEN" }]);
  // An invoice dated some days before or after its request still verifies.
  const later = await buildInvoiceValidationResult(filePath, { ...request, issueDate: "2026-10-13" });
  assert.equal(later.validated, true, JSON.stringify(later.errors));
  assert.equal(later.dateMatch, null);
  // A voucher's document date is the invoice's own date, so it must still match the file.
  await assert.rejects(() => assertVoucherEvidenceMatches(filePath, { ...voucher, issueDate: "2026-10-13" }), (error) =>
    error.code === "XML_AMOUNT_MISMATCH" && error.details.validation.mismatches.some((item) => item.field === "issueDate" && item.expected === "2026-10-13" && item.found === "2026-10-05"));
  assert.equal((await assertVoucherEvidenceMatches(filePath, voucher)).validated, true);
});

test("the XML is preferred when both files are attached", () => {
  const xml = { kind: "XML", path: "a.xml" }, pdf = { kind: "PDF", path: "a.pdf" };
  assert.equal(latestInvoiceEvidence([pdf, xml]), xml);
  assert.equal(latestInvoiceEvidence([pdf]), pdf);
  assert.equal(latestInvoiceEvidence([{ kind: "QUOTATION" }]), null);
});

const ipsLines = [
  "INTERNATIONAL PRIVATE SECURITY PERU S.A.C.", "RUC: 20603075251",
  "CALLE RODOLFO BELTRAN N� 120", "FACTURA ELECTRONICA", "LA VICTORIA - LIMA - LIMA",
  "Nro. F001-00008545", "Cliente: UNIVERSIDAD MARIA AUXILIADORA S.A.C. Moneda: SOLES IGV: 18.00 %",
  "RUC: 20550807123", "Fecha de Emision: Forma de Pago: Orden de Compra: Fecha de Vencimiento:",
  "02-sep-2026 Credito 02-oct-2026", "SUB TOTAL S/ 25,228.65", "IGV S/ 4,541.16",
  "Detraccion (12%) S/ 3,572.38 TOTAL S/ 29,769.81"
];
const ipsPdf = () => textPdf(ipsLines.map((line, index) => [40, 800 - index * 20, line]));

test("IPS F001-8545 preserves issuer, own number, issue date and gross total", async () => {
  const data = await parseInvoicePdf(ipsPdf(), { expectedRuc: "20550807123" });
  assert.equal(data.ruc, "20603075251", "even an incorrectly selected customer cannot override the issuer");
  assert.equal(data.invoiceNumber, "F001-00008545");
  assert.equal(data.issueDate, "2026-09-02");
  assert.equal(data.totalAmount, 29769.81);
  assert.doesNotThrow(() => assertReadableVoucher(data, "PDF"));
  assert.equal(invoiceFieldsFromLines(["Cliente:", "UNIVERSIDAD MARIA AUXILIADORA", "Direccion Lima", "RUC 20550807123"]).ruc, "");
  assert.equal(invoiceFieldsFromLines(["RUC 20550807123", "RUC 20603075251"]).ruc, "", "ambiguous parties require correction");
});

test("stale F901-14 XML is rejected before it can replace the uploaded PDF identity", async () => {
  const pdf = await stored("ips.pdf", ipsPdf());
  const stale = await stored("stale.xml", invoiceXml({ ...voucher, ruc: "20550807123", series: "F901", number: "14" }));
  await assert.rejects(() => assertInvoiceEvidencePair(stale, pdf), error => {
    assert.equal(error.code, "XML_VALIDATION_FAILED");
    assert.deepEqual(error.details.mismatches, [
      { field: "supplier", expected: "20550807123", found: "20603075251" },
      { field: "documentNumber", expected: "F901-14", found: "F001-8545" }
    ]);
    return true;
  });
  const matching = await stored("ips.xml", invoiceXml({ ...voucher, ruc: "20603075251", series: "F001", number: "8545" }));
  await assert.doesNotReject(() => assertInvoiceEvidencePair(matching, pdf));
  const scan = await stored("scan.pdf", textPdf([]));
  await assert.doesNotReject(() => assertInvoiceEvidencePair(matching, scan));
});

test("XML cannot obtain its supplier or own invoice ID from customer/reference blocks", async () => {
  const data = await parseInvoiceXml(await stored("no-issuer.xml", '<Invoice><AccountingCustomerParty><CompanyID>20550807123</CompanyID></AccountingCustomerParty><BillingReference><ID>F901-14</ID></BillingReference></Invoice>'));
  assert.equal(data.ruc, "");
  assert.equal(data.invoiceNumber, "");
});

test("duplicate lookup isolates supplier, type and invoice while retaining zero-padding and annulment rules", async (t) => {
  const records = [
    { rucIssuer: "20550807123", voucherType: "FACTURA", seriesNumber: "F901-14", validationStatus: "VALID", request: "SOL-2026-00014" },
    { rucIssuer: "20603075251", voucherType: "FACTURA", seriesNumber: "F001-00008545", validationStatus: "ANNULLED" }
  ];
  t.mock.method(SunatVoucher, "findOne", filter => ({ session: () => Promise.resolve(records.find(row =>
    row.rucIssuer === filter.rucIssuer && filter.voucherType.$in.includes(row.voucherType) &&
    filter.seriesNumber.test(row.seriesNumber) && (!filter.validationStatus || row.validationStatus !== filter.validationStatus.$ne)
  ) || null) }));
  const identity = { ruc: "20603075251", voucherType: "01", invoiceNumber: "F001-8545" };
  assert.equal(await findDuplicateVoucher(identity), null);
  records[1].validationStatus = "VALID";
  assert.equal(await findDuplicateVoucher(identity), records[1]);
  assert.equal(await findDuplicateVoucher({ ...identity, ruc: "20550807123" }), null);
  assert.equal(await findDuplicateVoucher({ ...identity, invoiceNumber: "F001-8546" }), null);
  assert.equal(await findDuplicateVoucher({ ...identity, voucherType: "07" }), null);
  assert.equal(await findDuplicateVoucher({ ruc: "20550807123", invoiceNumber: "F901-00000014" }), records[0]);
});

test("PDF invoice identity prefers its heading, excludes references and rejects ambiguity", () => {
  assert.equal(invoiceFieldsFromLines(["Referencia factura F901-14", "FACTURA ELECTRONICA", "Nro. F001-00008545"]).invoiceNumber, "F001-00008545");
  assert.equal(invoiceFieldsFromLines(["Servicio factura F901-14", "Nro. F001-00008545"]).invoiceNumber, "F001-00008545");
  assert.equal(invoiceFieldsFromLines(["F001-1", "F001-2"]).invoiceNumber, "");
});
