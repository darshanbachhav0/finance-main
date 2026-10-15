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
