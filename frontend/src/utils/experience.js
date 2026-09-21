// Presentation helpers only. Financial amounts and permissions remain server-owned.
export function notificationCategory(item) {
  const type = String(item.type || "");
  if (/SLA/.test(type)) return "SLA";
  if (/APPROV|OBSERV|REJECT|RETURN/.test(type)) return "Approvals";
  if (/PAY|TREASURY|BANK|RECONCIL/.test(type)) return "Payments";
  return "Other";
}

export function slaCountdown(request, now = Date.now()) {
  if (!["PENDIENTE_APROBACION", "APROBADO_DIRECTOR"].includes(request?.status)) return null;
  const due = Date.parse(request.approvalDueAt);
  if (!Number.isFinite(due)) return null;
  const minutes = Math.ceil(Math.abs(due - now) / 60000);
  return { overdue: due < now, days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 };
}

export function budgetMeasures(totals = {}) {
  const assigned = Number(totals.assigned) || 0;
  return ["committed", "executed", "paid", "available"].map(key => ({ key, value: Number(totals[key]) || 0, percent: assigned > 0 ? Math.max(0, Math.min(100, Number(totals[key] || 0) / assigned * 100)) : 0 }));
}

export function validateFiles(files, accept = "", multiple = false) {
  const accepted = accept.toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
  if (!multiple && files.length > 1) return "Choose one file at a time.";
  if (files.some(file => !file.size)) return "Empty files cannot be uploaded.";
  if (files.some(file => accepted.length && !accepted.some(type => type.startsWith(".") ? file.name.toLowerCase().endsWith(type) : type.endsWith("/*") ? file.type.startsWith(type.slice(0, -1)) : file.type === type))) return "This file type is not accepted. Check the allowed formats.";
  return "";
}

export function quotationDifference(quotation, quotations) {
  const amount = Number(quotation.amount);
  const comparable = quotations.filter(item => item.currency === quotation.currency && item.amount !== "" && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0);
  if (comparable.length < 2 || quotation.amount === "" || !(amount > 0)) return null;
  const minimum = Math.min(...comparable.map(item => Number(item.amount)));
  return { lowest: amount === minimum, difference: amount - minimum };
}

export async function fetchAllPages(api, path, params, signal) {
  const rows = [];
  let page = 1;
  do {
    const response = await api.get(path, { params: { ...params, page, pageSize: 100 }, signal });
    const data = response.data;
    rows.push(...(data.data || []));
    const pages = Number(data.pagination?.totalPages || 1);
    if (page >= pages) return rows;
    if (page >= 100) throw new Error("Too many records. Narrow the date range before viewing the calendar.");
    page++;
  } while (!signal?.aborted);
  throw new Error("Canceled");
}
