import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";
import { canonicalVoucherType } from "../utils/voucherIdentity.js";

// Reads the printed representation of a SUNAT electronic voucher (the factura PDF) and returns the
// same fields parseInvoiceXml() returns, so either file can evidence an invoice. Only the PDF's
// text layer is read: a scanned image has none and is reported as unreadable, never guessed.

const MAX_PAGES = 3;

export function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes("%PDF-");
}

let pdfjs;
async function loadPdfjs() {
  pdfjs ||= await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

// Text items come back as positioned fragments; rebuild reading-order lines (top to bottom, left to
// right) so a label and its amount on the same row end up on the same line.
export async function readPdfLines(buffer) {
  const { getDocument } = await loadPdfjs();
  let document;
  try {
    document = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  } catch {
    throw new AppError(422, "The factura PDF could not be opened. Upload the original PDF or the invoice XML.", undefined, ERROR_CODES.INVOICE_PDF_UNREADABLE);
  }
  const lines = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const { items } = await page.getTextContent();
      const rows = [];
      for (const item of items) {
        if (!item.str?.trim()) continue;
        const [x, y] = [item.transform[4], item.transform[5]];
        const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3);
        if (row) row.items.push({ x, text: item.str });
        else rows.push({ y, items: [{ x, text: item.str }] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) lines.push(row.items.sort((a, b) => a.x - b.x).map((item) => item.text.trim()).join(" ").replace(/\s+/g, " ").trim());
    }
  } finally {
    await document.destroy();
  }
  return lines.filter(Boolean);
}

// Uppercase without accents, so "Emisión", "EMISION" and "emisión" read the same.
const plain = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const MONEY = /(?<![\d.,])(\d{1,3}(?:[,.]\d{3})+|\d+)[.,](\d{2})(?![\d%])/g;
function moneyValues(line) {
  return [...line.matchAll(MONEY)].map((match) => Number(`${match[1].replace(/[.,]/g, "")}.${match[2]}`));
}

const RUC = /(?<!\d)((?:10|15|16|17|20)\d{9})(?!\d)/g;
const BUYER_LABEL = /SENOR\(?ES\)?|CLIENTE|ADQUIRENTE|ADQUIRIENTE|USUARIO|DOC\.? ?(DE )?IDENTIDAD|RAZON SOCIAL DEL/;

function rucs(lines) {
  const found = [];
  lines.forEach((line, index) => {
    for (const [, ruc] of line.matchAll(RUC)) {
      const context = [lines[index - 1] || "", line].join(" ");
      found.push({ ruc, buyer: BUYER_LABEL.test(plain(context)) });
    }
  });
  return found;
}

function documentType(text) {
  if (/NOTA DE CREDITO/.test(text)) return "07";
  if (/NOTA DE DEBITO/.test(text)) return "08";
  if (/RECIBO POR HONORARIOS/.test(text)) return "02";
  if (/BOLETA DE VENTA/.test(text)) return "03";
  if (/FACTURA/.test(text)) return "01";
  return "";
}

const SERIES = /(?<![A-Z0-9])([FBE][A-Z0-9]{3}|\d{4})\s*[-–]\s*(\d{1,8})(?!\d)/;
function seriesNumber(lines, type) {
  const preferred = { "01": "F", "03": "B", "02": "E", "07": "FB", "08": "FB" }[type] || "FBE";
  let fallback = "";
  for (const line of lines) {
    const match = plain(line).match(SERIES);
    if (!match) continue;
    const value = `${match[1]}-${match[2]}`;
    if (preferred.includes(match[1][0])) return value;
    fallback ||= value;
  }
  return fallback;
}

const MONTHS = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
function dateIn(line) {
  let match = line.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (match) return [match[1], match[2], match[3]];
  match = line.match(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/);
  if (match) return [match[3], match[2], match[1]];
  match = line.match(/(?<!\d)(\d{1,2}) DE ([A-Z]+) (?:DEL? )?(\d{4})/);
  if (match && MONTHS[match[2]]) return [match[3], MONTHS[match[2]], match[1]];
  return null;
}
function issueDate(lines) {
  const labelled = lines.findIndex((line) => /FECHA (DE )?EMISION|F\. ?EMISION|FECHA:/.test(line));
  const parts = (labelled >= 0 && (dateIn(lines[labelled]) || dateIn(lines[labelled + 1] || ""))) || lines.map(dateIn).find(Boolean);
  if (!parts) return "";
  const [year, month, day] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currency(lines, text) {
  const labelled = lines.find((line) => /\bMONEDA\b/.test(line)) || "";
  const source = labelled || text;
  if (/DOLAR|US\$|\bUSD\b/.test(source)) return "USD";
  if (/\bSOLES\b|\bS\/|\bPEN\b/.test(source)) return "PEN";
  return "";
}

// The totals block sits at the end, so the last labelled line wins (an item table's "Total" column
// header, earlier in the document, has no amount beside it).
function labelledAmount(lines, label) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(label);
    if (!match) continue;
    const after = lines[index].slice(match.index + match[0].length);
    const values = moneyValues(after);
    if (values.length) return values[values.length - 1];
  }
  return undefined;
}

const NET_LABEL = /OP(?:ERACION(?:ES)?|\.)? ?GRAVADAS?|VALOR (?:DE )?VENTA|SUB ?TOTAL(?: VENTAS?)?|BASE IMPONIBLE|OP(?:ERACION(?:ES)?|\.)? ?(?:EXONERADAS?|INAFECTAS?)|TOTAL POR HONORARIOS/;
const IGV_LABEL = /(?<![A-Z])I\.? ?G\.? ?V\.?(?![A-Z])(?: ?\(?\d{1,2}(?:[.,]\d+)? ?%\)?)?|IMPUESTO GENERAL A LAS VENTAS/;
const TOTAL_LABEL = /IMPORTE TOTAL|TOTAL A PAGAR|PRECIO (?:DE )?VENTA|TOTAL (?:DEL )?DOCUMENTO|MONTO TOTAL|TOTAL GENERAL|(?<![A-Z] )\bTOTAL\b(?! (?:POR|VALOR|IGV|I\.G\.V|DESCUENTO|ANTICIPO|OP))/;

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function invoiceFieldsFromLines(rawLines, { expectedRuc } = {}) {
  const lines = rawLines.map(plain);
  const text = lines.join("\n");
  const documentTypeCode = documentType(text);
  const candidates = rucs(lines);
  const issuer = candidates.find((candidate) => !candidate.buyer);
  // When the expected supplier's RUC is printed as a non-buyer RUC, it is the issuer.
  const ruc = (expectedRuc && candidates.find((candidate) => candidate.ruc === expectedRuc && !candidate.buyer)?.ruc) || issuer?.ruc || "";
  let netAmount = labelledAmount(lines, NET_LABEL);
  let igvAmount = documentTypeCode === "02" ? 0 : labelledAmount(lines, IGV_LABEL);
  let totalAmount = labelledAmount(lines, TOTAL_LABEL);
  if (documentTypeCode === "02") totalAmount = netAmount ?? totalAmount;
  // A factura with only exonerated/unaffected operations prints no IGV line; with a net and a total
  // that agree, its IGV is zero. Any one missing amount follows from the other two.
  if (igvAmount === undefined && netAmount !== undefined && totalAmount !== undefined) igvAmount = round2(totalAmount - netAmount);
  if (netAmount === undefined && igvAmount !== undefined && totalAmount !== undefined) netAmount = round2(totalAmount - igvAmount);
  if (totalAmount === undefined && netAmount !== undefined && igvAmount !== undefined) totalAmount = round2(netAmount + igvAmount);
  return {
    ruc,
    supplierName: "",
    invoiceNumber: seriesNumber(lines, documentTypeCode),
    documentTypeCode,
    voucherType: canonicalVoucherType(documentTypeCode || "01"),
    issueDate: issueDate(lines),
    currency: currency(lines, text),
    netAmount,
    igvAmount,
    totalAmount
  };
}

export async function parseInvoicePdf(buffer, options = {}) {
  const lines = await readPdfLines(buffer);
  if (!lines.length) {
    throw new AppError(422, "The factura PDF has no readable text (it looks like a scan or photo). Upload the invoice XML or the original PDF sent by the supplier.", undefined, ERROR_CODES.INVOICE_PDF_UNREADABLE);
  }
  return invoiceFieldsFromLines(lines, options);
}
