import { canAccessNavigation } from "./navigationAccess.js";

// Track A1 requests with committed budget and no Purchase Order yet (backend status alias).
export const AWAITING_PURCHASE_ORDER_PATH = "/requests?status=PENDIENTE_OC";

// Links open the related workspace, filtered to the statuses the metric counts. A comma-separated
// status list selects any of them (see listRequestsPage in the backend request service).
export function dashboardMetricLink(role, key) {
  let destination;
  if (role === "Budget" || ["budget", "available", "assigned", "committed", "executed", "paid"].includes(key)) {
    destination = ["/budget", "Open Budget Control"];
  } else if (role === "AreaDirector" || role === "ViceRector") {
    destination = ["/approvals", "Review approvals"];
  } else if (role === "Treasury") {
    destination = ["/treasury", "Open Treasury"];
  } else {
    destination = {
      users: ["/users", "View users"],
      supplierWarnings: ["/suppliers", "View suppliers"],
      blocked: ["/audit", "View audit history"],
      period: ["/accounting/periods", "Manage periods"],
      closure: ["/accounting/periods", "Manage periods"],
      cxp: ["/accounting/payables", "View payables"],
      debit: ["/accounting", "Open Accounting"],
      credit: ["/accounting", "Open Accounting"],
      spend: ["/reports", "Open reports"],
      capex: ["/requests?requestType=CAPEX", "View requests"],
      opex: ["/requests?requestType=OPEX", "View requests"],
      drafts: ["/requests?status=BORRADOR", "View drafts"],
      returned: ["/requests?status=DEVUELTO%2COBSERVADO", "View returned requests"],
      pending: ["/requests?status=PENDIENTE_APROBACION%2CAPROBADO_DIRECTOR%2CAPROBADO_VICERRECTOR", "View pending approvals"],
      awaitingOrder: [AWAITING_PURCHASE_ORDER_PATH, "View requests awaiting a PO"],
      rendition: ["/requests?renditionStatus=PENDING%2CSUBMITTED%2COBSERVED", "View pending renditions"],
      closed: ["/requests?status=CERRADO", "View requests"]
    }[key] || ["/requests", "View requests"];
  }
  return canAccessNavigation(role, destination[0].split("?")[0])
    ? { to: destination[0], actionLabel: destination[1] }
    : {};
}
