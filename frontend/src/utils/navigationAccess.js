export const authenticatedRoles = [
  "Admin",
  "Solicitor",
  "Approver",
  "Accounting",
  "Treasury",
  "Budget",
  "Procurement",
  "Management",
  "ManagementViewer"
];

export const navigationAccess = Object.freeze({
  "/": authenticatedRoles,
  "/management-view": ["Admin", "Management", "ManagementViewer"],
  "/requests": ["Admin", "Solicitor", "Approver", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  "/my-team": authenticatedRoles,
  "/requests/new": ["Admin", "Solicitor"],
  "/administration": ["Admin"],
  "/treasury/history": ["Admin", "Treasury"],
  "/accounting/invoices": ["Admin", "Accounting"],
  "/approvals": authenticatedRoles.filter(role => role !== "ManagementViewer"),
  "/batch-invoices": ["Admin", "Solicitor", "Accounting"],
  "/accounting": ["Admin", "Accounting"],
  "/accounting/payables": ["Admin", "Accounting"],
  "/accounting/invoice-observations": ["Admin", "Accounting"],
  "/treasury": ["Admin", "Treasury"],
  "/reimbursement-bank": ["Admin", "Solicitor", "Accounting", "Treasury"],
  "/budget": ["Admin", "Approver", "Accounting", "Budget", "Management"],
  "/accounting/periods": ["Admin", "Accounting"],
  "/accounting/sire": ["Admin", "Accounting"],
  "/reports": ["Admin", "Approver", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  "/suppliers": ["Admin", "Accounting", "Treasury", "Solicitor", "Procurement"],
  "/cost-centers": ["Admin", "Accounting"],
  "/expense-types": ["Admin", "Accounting"],
  "/exchange-rates": ["Admin", "Accounting"],
  "/configuration/projects": ["Admin", "Accounting", "Budget"],
  "/users": ["Admin"],
  "/audit": ["Admin", "Accounting"]
});

export function canAccessNavigation(role, path, user) {
  if (path === "/my-team" && user?.hasTeam !== true) return false;
  return Boolean(role && navigationAccess[path]?.includes(role));
}

export function visibleNavigationPaths(role, user) {
  return Object.entries(navigationAccess)
    .filter(([path]) => canAccessNavigation(role, path, user))
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
  Approver: [["Dashboard", "/"], ["Approvals", "/approvals"], ["Requests", "/requests"]],
  Budget: [["Dashboard", "/"], ["Budget Control", "/budget"], ["Requests", "/requests"]],
  Procurement: [["Dashboard", "/"], ["Requests", "/requests"], ["Suppliers", "/suppliers"], ["Reports", "/reports"]],
  Accounting: [["Dashboard", "/"], ["Accounting", "/accounting"], ["Accounts Payable", "/accounting/payables"], ["Invoices", "/accounting/invoices"], ["SIRE", "/accounting/sire"]],
  Treasury: [["Dashboard", "/"], ["Payments", "/treasury"], ["Payment History", "/treasury/history"]],
  Management: [["Dashboard", "/"], ["Approvals", "/approvals"], ["Reports", "/reports"], ["Shared Management View", "/management-view"]],
  ManagementViewer: [["Management Portal", "/management-view"]],
  Admin: [["Dashboard", "/"], ["Administration", "/administration"]]
};
