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
const BUYER_LABEL = /SENOR\(?ES\)?|CLIENTE|RECEPTOR|COMPRADOR|ADQUIRENTE|ADQUIRIENTE|USUARIO|DOC\.? ?(DE )?IDENTIDAD|RAZON SOCIAL DEL/;

function rucs(lines) {
  const found = [];
  let buyerSection = false;
  lines.forEach((line, index) => {
    if (/\bEMISOR\b|\bPROVEEDOR\b/.test(line)) buyerSection = false;
    if (BUYER_LABEL.test(line)) buyerSection = true;
    for (const [, ruc] of line.matchAll(RUC)) {
      const context = [lines[index - 1] || "", line].join(" ");
      // A separately named company starts a new party, even after a buyer block.
      if (!BUYER_LABEL.test(line) && /S\.?A\.?C\.?|S\.?A\.?\b|E\.?I\.?R\.?L\.?/.test(line)) buyerSection = false;
      found.push({ ruc, buyer: buyerSection || BUYER_LABEL.test(plain(context)) });
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
  const candidates = [];
  for (const line of lines) {
    // References and item descriptions can name another invoice. Only a unique
    // own-document candidate is safe; never take the first unrelated reference.
    if (/REFERENCIA|DOCUMENTO (?:AFECTADO|MODIFICADO)|FACTURA (?:AFECTADA|MODIFICADA)|GUIA DE REMISION/.test(line)) continue;
    for (const match of line.matchAll(new RegExp(SERIES.source, "g"))) {
      candidates.push({ value: `${match[1]}-${match[2]}`, preferred: preferred.includes(match[1][0]), labelled: /^(?:FACTURA|BOLETA|RECIBO|NOTA DE)|\bNRO\.?|NUMERO/.test(line) });
    }
  }
  const preferredCandidates = candidates.filter((item) => item.preferred);
  const compatible = preferredCandidates.length ? preferredCandidates : candidates;
  const labelled = compatible.filter((item) => item.labelled);
  const values = [...new Map((labelled.length ? labelled : compatible).map((item) => [item.value.replace(/-0+(?=\d)/, "-"), item.value])).values()];
  return values.length === 1 ? values[0] : "";
}

const MONTHS = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
function dateIn(line) {
  const shortMonths = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };
  const named = line.match(/(?<!\d)(\d{1,2})[-/.]([A-Z]{3})[-/.](\d{4})(?!\d)/);
  if (named && shortMonths[named[2]]) return [named[3], shortMonths[named[2]], named[1]];
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

// "Sol" is the singular some invoices print ("Tipo de moneda: Sol", "00/100 SOL").
function currencyIn(text) {
  if (/DOLAR|US\$|\bUSD\b/.test(text)) return "USD";
  if (/\bSOL(?:ES)?\b|\bS\/|\bPEN\b/.test(text)) return "PEN";
  return "";
}

// The currency is printed beside its "Moneda" label, or under it when the labels form a header row
// above their values ("Fecha ... Tipo de moneda: ... Forma de pago:" over "10/10/2026 ... Sol ...").
// Only when neither line names it is the whole text read (its amounts printed as "S/ 441.00").
function currency(lines, text) {
  const labelled = lines.findIndex((line) => /\bMONEDA\b/.test(line));
  return (labelled >= 0 && (currencyIn(lines[labelled]) || currencyIn(lines[labelled + 1] || ""))) || currencyIn(text);
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

// buyerRuc: the RUC of the party being invoiced (UMA). When the request's supplier is not known
// yet (reading a factura to fill a new request), it is never taken as the issuer even where the
// factura prints it without a "Cliente / Señor(es)" label.
export function invoiceFieldsFromLines(rawLines, { expectedRuc, buyerRuc } = {}) {
  const lines = rawLines.map(plain);
  const text = lines.join("\n");
  const documentTypeCode = documentType(text);
  const candidates = rucs(lines).filter((candidate) => !buyerRuc || candidate.ruc !== buyerRuc);
  const issuers = [...new Set(candidates.filter((candidate) => !candidate.buyer).map((candidate) => candidate.ruc))];
  // When the expected supplier's RUC is printed as a non-buyer RUC, it is the issuer.
  const ruc = (issuers.length === 1 ? issuers[0] : expectedRuc && issuers.includes(expectedRuc) ? expectedRuc : "") || "";
  // Prefer a subtotal over a single operations category (e.g. exonerated = 0).
  let netAmount = labelledAmount(lines, /VALOR (?:DE )?VENTA|SUB ?TOTAL(?: VENTAS?)?|BASE IMPONIBLE|TOTAL POR HONORARIOS/) ?? labelledAmount(lines, NET_LABEL);
  let igvAmount = documentTypeCode === "02" ? 0 : labelledAmount(lines, IGV_LABEL);
  let totalAmount = labelledAmount(lines, TOTAL_LABEL);
  if (documentTypeCode === "02") totalAmount = netAmount ?? totalAmount;
  // A factura with only exonerated/unaffected operations prints no IGV line; with a net and a total
  // that agree, its IGV is zero. Any one missing amount follows from the other two.
  if (igvAmount === undefined && netAmount !== undefined && totalAmount !== undefined) igvAmount = round2(totalAmount - netAmount);
  if (netAmount === undefined && igvAmount !== undefined && totalAmount !== undefined) netAmount = round2(totalAmount - igvAmount);
  if (netAmount === 0 && igvAmount >= 0 && totalAmount > igvAmount) netAmount = round2(totalAmount - igvAmount);
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
