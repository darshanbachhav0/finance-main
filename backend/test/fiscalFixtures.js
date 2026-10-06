import fs from "node:fs/promises";
import path from "node:path";
import { tempUploadDir } from "../src/services/storageService.js";
import { createSunatVoucher } from "../src/services/sunatVoucherService.js";

export function invoiceXml(v) {
  return `<Invoice><ID>${v.series}-${v.number}</ID><IssueDate>${String(v.issueDate).slice(0, 10)}</IssueDate><DocumentCurrencyCode>${v.currency}</DocumentCurrencyCode><AccountingSupplierParty><CompanyID>${v.ruc}</CompanyID></AccountingSupplierParty><TaxTotal><TaxAmount>${v.igvAmount}</TaxAmount></TaxTotal><LegalMonetaryTotal><LineExtensionAmount>${v.netAmount}</LineExtensionAmount><PayableAmount>${v.totalAmount}</PayableAmount></LegalMonetaryTotal></Invoice>`;
}
export async function fiscalFixture(request, supplier, voucher, user, cleanup) {
  await fs.mkdir(tempUploadDir, { recursive: true });
  const filename = `fiscal-${request._id}-${voucher.number}.xml`;
  const filePath = path.join(tempUploadDir, filename);
  await fs.writeFile(filePath, invoiceXml(voucher));
  cleanup.push(filePath);
  const xmlFile = { path: filePath, filename, originalName: filename, url: `/test/${filename}`, mimetype: "application/xml", size: 500 };
  const stored = await createSunatVoucher({ request, supplier, voucher, flowType: request.flowType, validationStatus: "VALID", xmlFile, user, sunatResult: { valid: true, taxpayer: { valid: true, source: "MOCK" }, fiscal: { valid: true, source: "MOCK" } } });
  return { stored, xmlFile };
}

// Minimal uncompressed ZIP fixture, including the real CRC checked by the reader.
export function invoiceZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(index, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

// Minimal text PDF (Helvetica, WinAnsi): one positioned string per [x, y, text], which is how a
// supplier's printed factura looks to the reader. With no rows it is a "scan": a page without text.
export function textPdf(rows) {
  const escape = (text) => text.replace(/[()\\]/g, (character) => `\\${character}`);
  const content = rows.length ? `BT /F1 10 Tf ${rows.map(([x, y, text]) => `1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj`).join(" ")} ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// The printed factura of the same voucher invoiceXml() describes.
export function invoicePdf(v, { buyerRuc = "20100000001" } = {}) {
  const money = (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [year, month, day] = String(v.issueDate).slice(0, 10).split("-");
  const symbol = v.currency === "USD" ? "US$" : "S/";
  return textPdf([
    [40, 800, "PROVEEDOR DE PRUEBA S.A.C."], [400, 800, `R.U.C. ${v.ruc}`],
    [400, 786, "FACTURA ELECTRÓNICA"], [400, 772, `${v.series}-${v.number}`],
    [40, 740, `Fecha de Emisión: ${day}/${month}/${year}`],
    [40, 726, "Señor(es): UNIVERSIDAD MARIA AUXILIADORA"], [40, 712, `RUC: ${buyerRuc}`],
    [40, 698, `Moneda: ${v.currency === "USD" ? "DÓLARES AMERICANOS" : "SOLES"}`],
    [40, 670, "Cant."], [100, 670, "Descripción"], [480, 670, "Total"],
    [40, 656, "1"], [100, 656, "Servicio"], [480, 656, money(v.netAmount)],
    [380, 620, "Op. Gravada"], [480, 620, `${symbol} ${money(v.netAmount)}`],
    [380, 606, "I.G.V. 18%"], [480, 606, `${symbol} ${money(v.igvAmount)}`],
    [380, 592, "Importe Total"], [480, 592, `${symbol} ${money(v.totalAmount)}`]
  ]);
}
