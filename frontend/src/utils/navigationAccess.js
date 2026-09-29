export const authenticatedRoles = [
  "Admin",
  "Solicitor",
  "AreaDirector",
  "ViceRector",
  "Accounting",
  "Treasury",
  "Budget",
  "Procurement",
  "Management",
  "ManagementViewer"
];

// Every role except the portal-only ManagementViewer.
export const internalRoles = authenticatedRoles.filter(role => role !== "ManagementViewer");

// Master-configuration resources (/configuration/:resource) and who may open each one. Mirrors
// the per-resource roles in pages/MasterConfiguration.jsx; the backend still decides writes.
export const configurationAccess = Object.freeze({
  "approval-rules": ["Admin"],
  "direct-payment-eligibility": ["Admin"],
  "finance-configurations": ["Admin", "Accounting"],
  "accounting-mappings": ["Admin", "Accounting"],
  "budget-rules": ["Admin", "Budget"],
  "budget-allocations": ["Admin", "Budget"],
  "bank-formats": ["Admin", "Treasury"]
});

// Roles allowed to download a stored report file (generated/reports) - must match the "reports"
// entry of generatedAccess in backend/src/services/fileAccessService.js.
export const reportDownloadRoles = Object.freeze(["Admin", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Management"]);

export const configurationRoles = [...new Set(Object.values(configurationAccess).flat())];

export const navigationAccess = Object.freeze({
  "/": authenticatedRoles,
  "/management-view": ["Admin", "Management", "ManagementViewer"],
  "/requests": ["Admin", "Solicitor", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  "/my-team": internalRoles,
  "/requests/new": ["Admin", "Solicitor"],
  "/administration": ["Admin"],
  "/treasury/history": ["Admin", "Treasury"],
  "/accounting/invoices": ["Admin", "Accounting"],
  "/approvals": internalRoles,
  "/batch-invoices": ["Admin", "Solicitor", "Accounting"],
  "/accounting": ["Admin", "Accounting"],
  "/accounting/payables": ["Admin", "Accounting"],
  "/accounting/invoice-observations": ["Admin", "Accounting"],
  "/treasury": ["Admin", "Treasury"],
  "/reimbursement-bank": ["Admin", "Solicitor", "Accounting", "Treasury"],
  "/budget": ["Admin", "AreaDirector", "ViceRector", "Accounting", "Budget", "Management"],
  "/accounting/periods": ["Admin", "Accounting"],
  "/accounting/sire": ["Admin", "Accounting"],
  "/reports": ["Admin", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  "/suppliers": ["Admin", "Accounting", "Treasury", "Solicitor", "Procurement"],
  "/cost-centers": ["Admin", "Accounting"],
  "/expense-types": ["Admin", "Accounting"],
  "/exchange-rates": ["Admin", "Accounting"],
  "/users": ["Admin"],
  "/configuration/*": configurationRoles,
  ...Object.fromEntries(Object.entries(configurationAccess).map(([resource, roles]) => [`/configuration/${resource}`, roles]))
});

export function canAccessNavigation(role, path, user) {
  if (path === "/my-team" && user?.hasTeam !== true) return false;
  if (path?.startsWith("/configuration/") && !navigationAccess[path]) return Boolean(role && navigationAccess["/configuration/*"].includes(role));
  return Boolean(role && navigationAccess[path]?.includes(role));
}

export function visibleNavigationPaths(role, user) {
  return Object.entries(navigationAccess)
    .filter(([path]) => !path.endsWith("/*") && canAccessNavigation(role, path, user))
    .map(([path]) => path);
}

// Primary navigation is deliberately smaller than the set of permitted routes.
export function navigationForUser(user) {
  const items = [...(roleNavigation[user?.role] || [])];
  if (user?.hasTeam === true && !items.some(([, path]) => path === "/my-team")) items.push(["My Team", "/my-team"]);
  return items.filter(([, path]) => canAccessNavigation(user?.role, path, user));
}

export const roleNavigation = {
  Solicitor: [["Dashboard", "/"], ["My Requests", "/requests"], ["New request", "/requests/new"], ["Approvals", "/approvals"]],
  AreaDirector: [["Dashboard", "/"], ["Approvals", "/approvals"], ["Requests", "/requests"]],
  ViceRector: [["Dashboard", "/"], ["Approvals", "/approvals"], ["Requests", "/requests"]],
  Budget: [["Dashboard", "/"], ["Budget Control", "/budget"], ["Requests", "/requests"]],
  Procurement: [["Dashboard", "/"], ["Requests", "/requests"], ["Suppliers", "/suppliers"], ["Reports", "/reports"]],
  Accounting: [["Dashboard", "/"], ["Accounting", "/accounting"], ["Accounts Payable", "/accounting/payables"], ["Invoices", "/accounting/invoices"], ["Invoice Observations", "/accounting/invoice-observations"], ["Suppliers", "/suppliers"], ["Accounting Periods", "/accounting/periods"], ["SIRE", "/accounting/sire"]],
  Treasury: [["Dashboard", "/"], ["Payments", "/treasury"], ["Payment History", "/treasury/history"], ["Bank Formats", "/configuration/bank-formats"]],
  Management: [["Dashboard", "/"], ["Approvals", "/approvals"], ["Reports", "/reports"], ["Shared Management View", "/management-view"]],
  // Portal only: no internal Reports, dashboards or request data.
  ManagementViewer: [["Management Portal", "/management-view"]],
  Admin: [["Dashboard", "/"], ["Administration", "/administration"]]
};

// Pending-task counters next to menu entries. Each path adds up the /dashboard/tasks counters
// of the work people act on from that page; a key the role does not receive counts as 0.
export const navigationCounterKeys = Object.freeze({
  "/approvals": ["approval"],
  "/treasury": ["payable", "paymentConfirmation"],
  "/accounting": ["accounting"],
  "/accounting/invoice-observations": ["invoiceObservations"],
  "/budget": ["budgetExceptions"],
  "/requests": ["requestCorrections", "rendition"],
  "/suppliers": ["suppliers"]
});

export function navigationCount(path, counters) {
  return (navigationCounterKeys[path] || []).reduce((sum, key) => {
    const value = Number(counters?.[key]);
    return sum + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  }, 0);
}

// Badge text: nothing at 0, capped at "99+".
export function counterBadgeText(count) {
  const value = Number(count) || 0;
  if (value <= 0) return "";
  return value > 99 ? "99+" : String(value);
}

// Phone bottom bar: up to three main destinations per role (from roleNavigation), plus Search.
export const bottomNavigation = Object.freeze({
  Solicitor: ["/", "/requests", "/requests/new"],
  AreaDirector: ["/", "/approvals", "/requests"],
  ViceRector: ["/", "/approvals", "/requests"],
  Budget: ["/", "/budget", "/requests"],
  Procurement: ["/", "/requests", "/suppliers"],
  Accounting: ["/", "/accounting", "/accounting/invoice-observations"],
  Treasury: ["/", "/treasury", "/treasury/history"],
  Management: ["/", "/approvals", "/reports"],
  Admin: ["/", "/administration"]
});

// Shorter labels where the menu label does not fit a bottom-bar slot.
export const bottomNavigationLabels = Object.freeze({
  "/accounting/invoice-observations": "Observations",
  "/treasury/history": "History",
  "/budget": "Budget"
});

export function bottomNavigationForUser(user) {
  const items = navigationForUser(user);
  // A requester who also approves for a team gets Approvals in place of the request list.
  const paths = user?.role === "Solicitor" && user?.hasTeam === true ? ["/", "/approvals", "/requests/new"] : bottomNavigation[user?.role];
  const chosen = paths ? paths.map((path) => items.find(([, itemPath]) => itemPath === path)).filter(Boolean) : items.slice(0, 3);
  return chosen.slice(0, 3).map(([label, path]) => ({ label: bottomNavigationLabels[path] || label, path }));
}
