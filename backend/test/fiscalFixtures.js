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
