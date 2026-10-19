// The employee's simple rendition of an advance: one row per expense, and the money returned.
// Rows are of three kinds; each is saved as the rendition detail Accounting already reviews:
// RECEIPT -> receiptLines (with its file), TRANSPORT -> mobilityLines, NO_RECEIPT ->
// unsupportedExpenseLines. The accounting allocation is built from them on the request's CECO.
export const RECEIPT_TYPES = Object.freeze(["FACTURA", "BOLETA", "TICKET", "RECIBO_HONORARIOS", "OTHER"]);
export const RENDITION_STAGES = Object.freeze(["PENDING", "OBSERVED", "SUBMITTED", "VALIDATED", "REJECTED"]);

const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => Math.round(value) / 100;
let sequence = 0;
const clientId = () => `row-${Date.now()}-${(sequence += 1)}`;

export function emptyRow(kind, date) {
  return { clientId: clientId(), kind, date, documentType: kind === "RECEIPT" ? "BOLETA" : "", documentNumber: "", issuerRuc: "", description: "", origin: "", destination: "", amount: "", file: null, attachment: null };
}

// The rows saved on a rendition (after Accounting sent it back, the employee corrects them).
export function rowsFromRendition(rendition = {}) {
  const date = (value) => (value ? String(value).slice(0, 10) : "");
  return [
    ...(rendition.receiptLines || []).map((line) => ({ ...emptyRow("RECEIPT", date(line.date)), documentType: line.documentType || "BOLETA", documentNumber: line.documentNumber || "", issuerRuc: line.issuerRuc || "", description: line.description || "", amount: String(line.amount ?? ""), attachment: line.attachment || null })),
    ...(rendition.mobilityLines || []).map((line) => ({ ...emptyRow("TRANSPORT", date(line.date)), origin: line.origin || "", destination: line.destination || "", description: line.servicePurpose || "", amount: String(line.amount ?? "") })),
    ...(rendition.unsupportedExpenseLines || []).map((line) => ({ ...emptyRow("NO_RECEIPT", date(line.date)), description: line.description || "", amount: String(line.grossAmount ?? "") }))
  ];
}

// Advanced, spent, returned and what is left; the rendition is sent when the balance is 0.
export function renditionTotals({ rows = [], advanced = 0, returned = 0 }) {
  const spent = rows.reduce((total, row) => total + cents(row.amount), 0);
  const back = cents(returned);
  return { advanced: money(cents(advanced)), spent: money(spent), returned: money(back), balance: money(cents(advanced) - spent - back) };
}

// A factura's amount includes 18% IGV; other receipts carry no creditable IGV.
export function igvSplit(row) {
  const total = cents(row.amount);
  if (row.kind !== "RECEIPT" || row.documentType !== "FACTURA") return { net: money(total), igv: 0, total: money(total) };
  const net = Math.round(total / 1.18);
  return { net: money(net), igv: money(total - net), total: money(total) };
}

// One accounting line on the request's cost center, for the whole amount spent.
export function accountingLines(rows, costCenter) {
  const parts = rows.map(igvSplit);
  const total = parts.reduce((sum, part) => sum + cents(part.total), 0);
  if (!total || !costCenter) return [];
  const igv = parts.reduce((sum, part) => sum + cents(part.igv), 0);
  return [{ costCenter, netAmount: money(total - igv), igvAmount: money(igv), totalAmount: money(total) }];
}

// What is still missing, in plain words (English keys; the page translates them).
export function rowProblems(row) {
  const problems = [];
  if (!row.date) problems.push("the date");
  if (!(cents(row.amount) > 0)) problems.push("the amount");
  if (row.kind === "TRANSPORT") {
    if (!row.origin.trim()) problems.push("where you went from");
    if (!row.destination.trim()) problems.push("where you went to");
  } else if (!row.description.trim()) problems.push("what it was for");
  if (row.kind === "RECEIPT" && !row.file && !row.attachment) problems.push("the photo or PDF of the receipt");
  if (row.kind === "RECEIPT" && row.issuerRuc && !/^\d{11}$/.test(row.issuerRuc.replace(/\s/g, ""))) problems.push("an 11-digit RUC");
  return problems;
}

// The form data the rendition endpoint expects. Receipt files go first, in row order, so each
// receipt line points at its file by position; files on other rows are extra evidence.
export function renditionPayload({ rows, returned, costCenter, purpose }) {
  const files = [];
  const receiptLines = [];
  for (const row of rows.filter((item) => item.kind === "RECEIPT")) {
    const line = { date: row.date, documentType: row.documentType, documentNumber: row.documentNumber.trim(), issuerRuc: row.issuerRuc.replace(/\s/g, ""), description: row.description.trim(), amount: money(cents(row.amount)) };
    if (row.file) { line.fileIndex = files.length; files.push(row.file); } else line.attachment = row.attachment;
    receiptLines.push(line);
  }
  for (const row of rows) if (row.kind !== "RECEIPT" && row.file) files.push(row.file);
  return {
    files,
    receiptLines,
    mobilityLines: rows.filter((row) => row.kind === "TRANSPORT").map((row) => ({ date: row.date, origin: row.origin.trim(), destination: row.destination.trim(), servicePurpose: row.description.trim() || purpose, amount: money(cents(row.amount)) })),
    unsupportedExpenseLines: rows.filter((row) => row.kind === "NO_RECEIPT").map((row) => ({ date: row.date, description: row.description.trim(), goodsServiceType: "SERVICES", grossAmount: money(cents(row.amount)) })),
    lines: accountingLines(rows, costCenter),
    amountReturned: money(cents(returned))
  };
}

// Transport per day above the daily limit Finance configured (a warning, not a block).
export function transportDaysOverLimit(rows, limit) {
  if (!(Number(limit) > 0)) return [];
  const byDay = {};
  for (const row of rows) if (row.kind === "TRANSPORT" && row.date) byDay[row.date] = (byDay[row.date] || 0) + cents(row.amount);
  return Object.entries(byDay).filter(([, total]) => total > cents(limit)).map(([day]) => day).sort();
}
