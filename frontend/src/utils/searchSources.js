export function searchSources(role) {
  const sources = [{ endpoint: "/requests", kind: "Request", title: row => row.requestNumber, subtitle: row => row.title || row.supplier?.name, path: row => `/requests/${row._id}` }];
  if (["Admin", "Solicitor", "Accounting", "Treasury"].includes(role)) sources.push({ endpoint: "/suppliers", kind: "Supplier", title: row => row.legalName || row.name, subtitle: row => row.rucDni, path: row => `/suppliers?search=${encodeURIComponent(row.rucDni || row.name)}` });
  if (["Admin", "Accounting"].includes(role)) {
    sources.push({ endpoint: "/cost-centers", kind: "Cost center", title: row => row.code, subtitle: row => row.name, path: row => `/cost-centers?search=${encodeURIComponent(row.code)}` });
    sources.push({ endpoint: "/accounting/accounts-payable", kind: "Invoice / CXP", title: row => [row.voucher?.series, row.voucher?.number].filter(Boolean).join("-") || row.request?.requestNumber, subtitle: row => row.supplier?.name, path: row => row.request?._id ? `/requests/${row.request._id}` : "/accounting/payables" });
  }
  if (["Admin", "Accounting", "Solicitor"].includes(role)) sources.push({ endpoint: "/batch-invoices/purchase-orders", kind: "Active purchase order", title: row => row.poNumber, subtitle: row => row.supplier?.name, path: row => `/requests/${row.request?._id || row.request}` });
  if (["Admin", "Treasury"].includes(role)) sources.push({ endpoint: "/treasury/bank-files", kind: "Payment batch", title: row => row.batchNumber, subtitle: row => row.currency, path: row => `/treasury/history?search=${encodeURIComponent(row.batchNumber)}` });
  return role === "ManagementViewer" ? [] : sources;
}
