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
