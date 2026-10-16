import { calculateEditorLine } from "./requestLineEditor.js";

const cents = (value) => Math.round(Number(value || 0) * 100);
const digits = (value) => String(value || "").replace(/\D/g, "");

// One request line that reproduces the invoice exactly: priced with IGV included, else without,
// else (an exonerated or rounded invoice) with its own net / IGV / total kept as they are.
export function lineFromInvoice(invoice, { costCenter = "", description = "" } = {}) {
  const base = { clientId: `${Date.now()}-${Math.random()}`, itemDescription: description, quantity: "1", unitOfMeasure: "UNIT", costCenter, budgetItem: "", projectId: "" };
  for (const [priceIncludesIGV, unitPrice] of [[true, invoice.totalAmount], [false, invoice.netAmount]]) {
    if (!(Number(unitPrice) > 0)) continue;
    const candidate = calculateEditorLine({ ...base, priceIncludesIGV, unitPrice: String(unitPrice) });
    if (!candidate.calculationError && ["netAmount", "igvAmount", "totalAmount"].every((key) => cents(candidate[key]) === cents(invoice[key]))) return candidate;
  }
  return { ...base, unitPrice: String(invoice.totalAmount ?? ""), priceIncludesIGV: undefined, legacyAmounts: true, subtotal: invoice.totalAmount, netAmount: invoice.netAmount, igvAmount: invoice.igvAmount, totalAmount: invoice.totalAmount };
}

// SUNAT unit codes (Catálogo 03) the request form has a unit for; anything else reads as a unit.
const UNIT_CODES = { NIU: "UNIT", ZZ: "SERVICE", HUR: "HOUR", DAY: "DAY", MON: "MONTH", SET: "SET", BX: "BOX", KGM: "KG", LTR: "LITER", MTR: "METER" };

// One request line per factura item (as read from its XML): priced without IGV when that gives the
// item's own net / IGV / total, with IGV included otherwise, else its amounts kept as they are.
function lineFromInvoiceItem(item, { costCenter }) {
  const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  const base = { clientId: `${Date.now()}-${Math.random()}`, itemDescription: item.description || "", quantity: String(quantity), unitOfMeasure: UNIT_CODES[String(item.unitCode || "").toUpperCase()] || "UNIT", costCenter, budgetItem: "", projectId: "" };
  for (const [priceIncludesIGV, amount] of [[false, item.netAmount], [true, item.totalAmount]]) {
    const unitCents = cents(amount) / quantity;
    if (!Number.isInteger(unitCents) || unitCents <= 0) continue;
    const candidate = calculateEditorLine({ ...base, priceIncludesIGV, unitPrice: String(unitCents / 100) });
    if (!candidate.calculationError && ["netAmount", "igvAmount", "totalAmount"].every((key) => cents(candidate[key]) === cents(item[key]))) return candidate;
  }
  return { ...base, unitPrice: String(Math.round(cents(item.netAmount) / quantity) / 100), priceIncludesIGV: undefined, legacyAmounts: true, subtotal: item.totalAmount, netAmount: item.netAmount, igvAmount: item.igvAmount, totalAmount: item.totalAmount };
}

// "Invoice in, request out": the factura's own items when they add up to its totals to the cent,
// else one line that reproduces the invoice (lineFromInvoice).
export function linesFromInvoice(invoice, { costCenter = "", description = "" } = {}) {
  const items = Array.isArray(invoice?.lines) ? invoice.lines : [];
  const sum = (key) => items.reduce((total, item) => total + cents(item[key]), 0);
  if (items.length && ["netAmount", "igvAmount", "totalAmount"].every((key) => invoice[key] === undefined || invoice[key] === null || sum(key) === cents(invoice[key]))) {
    return items.map((item) => lineFromInvoiceItem(item, { costCenter }));
  }
  return [lineFromInvoice(invoice, { costCenter, description })];
}

// The checks the platform runs when a Track B request is saved, shown while the form is filled:
// currency, supplier RUC, and net / IGV / total to the cent. Rows without data on either side are
// left out.
export function invoiceMatchRows({ invoice, form, totals, supplier }) {
  if (!invoice) return [];
  const rows = [];
  if (invoice.currency) rows.push({ key: "currency", label: "Currency", ok: invoice.currency === form.currency, expected: form.currency, found: invoice.currency });
  if (supplier && invoice.ruc) rows.push({ key: "supplier", label: "Supplier RUC", ok: digits(supplier.normalizedIdentifier || supplier.rucDni) === digits(invoice.ruc), expected: supplier.rucDni, found: invoice.ruc });
  for (const [key, label, total] of [["netAmount", "Net", totals.net], ["igvAmount", "IGV", totals.igv], ["totalAmount", "Total", totals.total]]) {
    if (invoice[key] === undefined || invoice[key] === null) continue;
    rows.push({ key, label, money: true, ok: cents(invoice[key]) === cents(total), expected: total, found: invoice[key], difference: (cents(total) - cents(invoice[key])) / 100 });
  }
  return rows;
}

export const invoiceFileKey = (file) => (/\.xml$/i.test(file?.name || "") ? "xml" : "pdf");
