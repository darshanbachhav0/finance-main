import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { invoiceFieldsFromLines, parseInvoicePdf } from "../src/services/invoicePdfService.js";
import { assertReadableVoucher, buildInvoiceValidationResult, latestInvoiceEvidence, parseInvoiceEvidence, parseInvoiceXml } from "../src/services/xmlValidationService.js";
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
});

test("the XML is preferred when both files are attached", () => {
  const xml = { kind: "XML", path: "a.xml" }, pdf = { kind: "PDF", path: "a.pdf" };
  assert.equal(latestInvoiceEvidence([pdf, xml]), xml);
  assert.equal(latestInvoiceEvidence([pdf]), pdf);
  assert.equal(latestInvoiceEvidence([{ kind: "QUOTATION" }]), null);
});
