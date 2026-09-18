import { canAccessNavigation } from "./navigationAccess.js";

// Links open the related workspace. Only single-status metrics apply an exact filter.
export function dashboardMetricLink(role, key) {
  let destination;
  if (role === "Budget" || ["budget", "available", "assigned", "committed", "executed", "paid"].includes(key)) {
    destination = ["/budget", "Open Budget Control"];
  } else if (role === "Approver") {
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
      rendition: ["/requests?renditionStatus=PENDING%2CSUBMITTED%2COBSERVED", "View pending renditions"],
      closed: ["/requests?status=CERRADO", "View requests"]
    }[key] || ["/requests", "View requests"];
  }
  return canAccessNavigation(role, destination[0].split("?")[0])
    ? { to: destination[0], actionLabel: destination[1] }
    : {};
}
