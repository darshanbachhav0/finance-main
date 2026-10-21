import { sumMoney } from "../utils/money.js";

// BBVA's certified layout requires invoice references: group the review, never discard
// invoice-level bank records or combine incompatible payment destinations.
export function paymentBatchSummary(items = []) {
  const groups = new Map();
  for (const item of items) {
    const account = item.bankAccountSnapshot || item.bankAccount || {};
    const identity = String(item.supplier?._id || item.supplier || item.supplierIdentifier || item.accountsPayable?.beneficiarySnapshot?.user || item.request?._id || item.request);
    const key = JSON.stringify([identity, account.sourceType || "SUPPLIER", account.bank, account.currency || item.currency,
      account.accountType, account.accountNumber, account.cci, item.priority, item.paymentInstructions || ""]);
    if (!groups.has(key)) groups.set(key, { supplierId: identity, supplierIdentifier: item.supplierIdentifier, supplierName: item.supplierName,
      bank: account.bank, currency: account.currency || item.currency, accountLast4: String(account.accountNumber || account.cci || "").slice(-4),
      accountType: account.accountType, priority: item.priority, items: [] });
    groups.get(key).items.push({ payableId: String(item.accountsPayable?._id || item.accountsPayable), requestId: String(item.request?._id || item.request),
      requestNumber: item.requestNumber, voucherNumber: item.voucherNumber || [item.accountsPayable?.voucher?.series, item.accountsPayable?.voucher?.number].filter(Boolean).join("-"), amount: item.amount, currency: item.currency });
  }
  const suppliers = [...groups.values()].map(group => ({ ...group, total: sumMoney(group.items.map(item => item.amount)) }));
  const currencies = [...new Set(items.map(item => item.currency))];
  return { supplierCount: new Set(suppliers.map(item => item.supplierId)).size,
    requestCount: new Set(items.map(item => String(item.request?._id || item.request))).size, payableCount: items.length,
    total: currencies.length <= 1 ? sumMoney(items.map(item => item.amount)) : null,
    totalsByCurrency: Object.fromEntries(currencies.map(code => [code, sumMoney(items.filter(item => item.currency === code).map(item => item.amount))])),
    suppliers, consolidatedBankRecords: false };
}

export function paymentSummaryCsv(batch) {
  const summary = paymentBatchSummary(batch.items);
  const cell = value => `"${String(value ?? "").replace(/^[=+@-]/, "'").replace(/"/g, '""')}"`;
  const rows = [["Lote", "Proveedor", "RUC / DNI", "Banco destino", "Cuenta (últimos 4)", "Moneda", "Solicitud", "Comprobante", "Neto", "Subtotal proveedor / cuenta"]];
  for (const supplier of summary.suppliers) for (const [index,item] of supplier.items.entries()) rows.push([batch.batchNumber, supplier.supplierName, supplier.supplierIdentifier, supplier.bank, supplier.accountLast4, supplier.currency, item.requestNumber, item.voucherNumber, Number(item.amount).toFixed(2), index === 0 ? supplier.total.toFixed(2) : ""]);
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
