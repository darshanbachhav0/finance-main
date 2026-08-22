export const authenticatedRoles = [
  "Admin",
  "Solicitor",
  "Approver",
  "Accounting",
  "Treasury",
  "Budget",
  "Management"
];

export const navigationAccess = Object.freeze({
  "/": authenticatedRoles,
  "/requests": authenticatedRoles,
  "/approvals": ["Admin", "Approver", "Management"],
  "/batch-invoices": ["Admin", "Solicitor", "Accounting"],
  "/accounting": ["Admin", "Accounting"],
  "/accounting/payables": ["Admin", "Accounting"],
  "/accounting/invoice-observations": ["Admin", "Accounting"],
  "/treasury": ["Admin", "Treasury"],
  "/reimbursement-bank": ["Admin", "Solicitor", "Accounting", "Treasury"],
  "/budget": ["Admin", "Approver", "Accounting", "Budget", "Management"],
  "/accounting/periods": ["Admin", "Accounting"],
  "/accounting/sire": ["Admin", "Accounting"],
  "/reports": ["Admin", "Approver", "Accounting", "Treasury", "Budget", "Management"],
  "/suppliers": ["Admin", "Accounting", "Treasury", "Solicitor"],
  "/cost-centers": ["Admin", "Accounting"],
  "/expense-types": ["Admin", "Accounting"],
  "/exchange-rates": ["Admin", "Accounting"],
  "/configuration/projects": ["Admin", "Accounting", "Budget"],
  "/users": ["Admin"],
  "/audit": ["Admin", "Accounting"]
});

export function canAccessNavigation(role, path) {
  return Boolean(role && navigationAccess[path]?.includes(role));
}

export function visibleNavigationPaths(role) {
  return Object.entries(navigationAccess)
    .filter(([, roles]) => roles.includes(role))
    .map(([path]) => path);
}
