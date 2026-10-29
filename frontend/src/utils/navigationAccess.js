import { hasRole, PERMISSIONS as P, ROLES, rolesOf, userCan } from "./access.js";

// Menus and page access, from the role and permission catalog (shared/accessControl.mjs). Each page
// opens for the permissions that do its work; each role's menu lists the few pages of its daily
// work (Manual de usuario, "Perfiles y menús"); a person with several roles gets every menu,
// merged. The API enforces the same permissions on every call.

export const authenticatedRoles = Object.freeze(Object.values(ROLES));
// Roles that raise their own requests and see "My requests".
export const requesterRoles = Object.freeze([ROLES.SOLICITOR]);
export const internalRoles = Object.freeze(authenticatedRoles.filter((role) => role !== ROLES.AUDITOR));

const any = (...permissions) => (user) => userCan(user, ...permissions);
const everyone = () => true;

// Master-configuration resources (/configuration/:resource) and who opens each one. The backend
// decides writes (masterDataRoutes.js) with the same permissions.
export const configurationAccess = Object.freeze({
  // The GAF sets the approval thresholds; the administrator reviews the hierarchy (read-only).
  "approval-rules": any(P.FINANCE_PARAMETERS_MANAGE, P.EMPLOYEE_MANAGE),
  "finance-configurations": any(P.FINANCE_PARAMETERS_MANAGE),
  "accounting-mappings": any(P.ACCOUNTING_CODES_MANAGE),
  "budget-rules": any(P.BUDGET_MANAGE),
  "budget-allocations": any(P.BUDGET_MANAGE),
  "bank-formats": any(P.BANK_FORMAT_CERTIFY)
});

// Who opens each page.
const pageAccess = Object.freeze({
  "/": everyone,
  "/requests": any(P.REQUEST_VIEW, P.REQUEST_CREATE),
  "/requests/new": any(P.REQUEST_CREATE, P.BATCH_INVOICE_UPLOAD, P.TREASURY_TRANSFER, P.HONORARIOS_MANAGE),
  "/approvals": (user) => !hasRole(user, ROLES.AUDITOR) && rolesOf(user).length > 0,
  "/my-team": (user) => user?.hasTeam === true && !hasRole(user, ROLES.AUDITOR),
  "/special-expenses": (user) => userCan(user, P.REQUEST_CREATE, P.HONORARIOS_MANAGE, P.LEGAL_REVIEW) || userCan(user, P.INSIGHTS_VIEW),
  "/guides": (user) => rolesOf(user).length > 0,
  "/batch-invoices": any(P.BATCH_INVOICE_UPLOAD, P.BATCH_INVOICE_REVIEW),
  "/accounting/invoice-observations": any(P.BATCH_INVOICE_REVIEW),
  "/accounting/payables": any(P.ACCOUNTING_PROVISION),
  "/accounting": any(P.ACCOUNTING_PROVISION),
  "/accounting/periods": any(P.ACCOUNTING_CLOSE_PERIOD, P.ACCOUNTING_REOPEN_PERIOD),
  "/accounting/sire": any(P.ACCOUNTING_EXPORT),
  "/accounting/bank-files": any(P.BATCH_APPROVE),
  "/reimbursement-bank": any(P.EMPLOYEE_BANK_MANAGE_OWN, P.EMPLOYEE_BANK_REVIEW, P.EMPLOYEE_BANK_VIEW_PAYMENT),
  "/treasury": any(P.TREASURY_SCHEDULE),
  "/treasury/history": any(P.TREASURY_SCHEDULE),
  "/treasury/transfers": any(P.TREASURY_TRANSFER, P.BATCH_APPROVE, P.ACCOUNTING_PROVISION),
  "/treasury/statement-reviews": any(P.RECONCILIATION_PREPARE, P.RECONCILIATION_SIGN, P.BATCH_APPROVE),
  "/investments": any(P.TREASURY_INVESTMENT, P.INVESTMENT_APPROVE, P.INSIGHTS_VIEW),
  "/budget": any(P.BUDGET_VIEW),
  "/reports": any(P.REPORT_VIEW),
  "/consultas": any(P.INSIGHTS_VIEW),
  "/indicadores": any(P.INSIGHTS_VIEW),
  "/audit": (user) => userCan(user, P.AUDIT_READ) && userCan(user, P.INSIGHTS_VIEW),
  "/suppliers": any(P.SUPPLIER_VIEW, P.SUPPLIER_CREATE, P.SUPPLIER_BANK_VIEW),
  "/users": any(P.EMPLOYEE_MANAGE),
  "/administration/access": any(P.ROLE_MANAGE),
  "/cost-centers": any(P.COST_CENTER_MANAGE, P.ACCOUNTING_CODES_MANAGE),
  "/administration/audit": (user) => userCan(user, P.AUDIT_READ) && userCan(user, P.EMPLOYEE_MANAGE),
  "/administration": any(P.PLATFORM_MANAGE),
  "/administration/alerts": any(P.PLATFORM_MANAGE),
  "/administration/settings": any(P.PLATFORM_MANAGE),
  "/expense-types": any(P.ACCOUNTING_CODES_MANAGE),
  "/exchange-rates": any(P.ACCOUNTING_CODES_MANAGE, P.TREASURY_SCHEDULE),
  ...Object.fromEntries(Object.entries(configurationAccess).map(([resource, rule]) => [`/configuration/${resource}`, rule]))
});

// The one list of page names (English keys translated by t()). The sidebar, phone bar, command
// palette, breadcrumbs and the browser tab title all read their labels from here.
export const pageLabels = Object.freeze({
  "/": "Home",
  "/requests": "Requests",
  "/guides": "Guía y modelos",
  "/investments": "Inversiones",
  "/special-expenses": "Solicitudes especiales",
  "/treasury/statement-reviews": "Conciliaciones",
  "/audit": "Auditoría",
  "/consultas": "Consultas",
  "/indicadores": "Indicadores",
  "/requests/new": "New request",
  "/approvals": "Approvals",
  "/my-team": "My Team",
  "/batch-invoices": "A2 Batch Invoices",
  "/accounting/invoice-observations": "Invoice Observations",
  "/accounting/payables": "To post",
  "/accounting/bank-files": "Batches to approve",
  "/reimbursement-bank": "Reimbursement Banking",
  "/treasury": "Scheduling and payments",
  "/treasury/history": "Payment History",
  "/treasury/transfers": "Transfers",
  "/accounting": "Accounting Entries",
  "/accounting/periods": "Periods and closing",
  "/accounting/sire": "SIRE Export",
  "/budget": "Budget Control",
  "/reports": "Reports",
  "/suppliers": "Suppliers",
  "/settings": "Settings",
  "/users": "Employees",
  "/administration/access": "Roles and permissions",
  "/cost-centers": "Cost centers and hierarchy",
  "/administration/audit": "Administrative audit",
  "/administration": "Platform",
  "/administration/alerts": "Security alerts",
  "/administration/settings": "Platform settings",
  "/expense-types": "Accounting Accounts",
  "/exchange-rates": "Exchange Rates",
  "/configuration/approval-rules": "Approval Rules",
  "/configuration/finance-configurations": "Finance Configurations",
  "/configuration/budget-rules": "Budget Rules",
  "/configuration/budget-allocations": "Budget Allocations",
  "/configuration/accounting-mappings": "Accounting Mappings",
  "/configuration/bank-formats": "Bank Formats"
});

// The same page named for the work a role does there (primary role first).
const roleLabels = Object.freeze({
  [ROLES.SOLICITOR]: { "/requests": "My Requests" },
  [ROLES.AREA_DIRECTOR]: { "/budget": "Budgets and indicators", "/reports": "Consultas" },
  [ROLES.VICE_RECTOR]: { "/budget": "Budgets and indicators", "/reports": "Consultas" },
  [ROLES.GAF]: { "/settings": "Rules and parameters" },
  [ROLES.LEGAL]: { "/special-expenses": "Refunds to validate", "/requests": "Consultas" },
  [ROLES.HUMAN_RESOURCES]: { "/special-expenses": "Honorarios" },
  [ROLES.AUDITOR]: { "/requests": "Financial history" }
});

function subjectOf(roleOrUser, user) {
  if (user) return user;
  return typeof roleOrUser === "string" ? { role: roleOrUser } : roleOrUser;
}

export function pageLabel(path, roleOrUser) {
  const roles = typeof roleOrUser === "string" ? [roleOrUser] : rolesOf(roleOrUser);
  for (const role of roles) if (roleLabels[role]?.[path]) return roleLabels[role][path];
  return pageLabels[path] || "";
}

// Settings pages, grouped as on the Settings page. Each one keeps its own route.
export const settingsGroups = Object.freeze([
  ["Organization", ["/cost-centers"]],
  ["Finance", ["/expense-types", "/configuration/accounting-mappings", "/configuration/finance-configurations", "/exchange-rates"]],
  ["Approval and budget rules", ["/configuration/approval-rules", "/configuration/budget-rules", "/configuration/budget-allocations"]],
  ["Banking", ["/configuration/bank-formats"]]
]);

export const settingsPaths = settingsGroups.flatMap(([, paths]) => paths);

export function hasGrant(user, ...permissions) {
  return permissions.some((permission) => (user?.permissions || []).includes(permission));
}

// canAccessNavigation(role, path) or canAccessNavigation(role, path, user): whether the page opens.
export function canAccessNavigation(roleOrUser, path, user) {
  const subject = subjectOf(roleOrUser, user);
  if (!subject || !rolesOf(subject).length) return false;
  if (path === "/settings") return settingsPagesFor(subject).length > 0;
  const clean = String(path || "").split("?")[0];
  if (clean.startsWith("/configuration/") && !pageAccess[clean]) return Object.values(configurationAccess).some((rule) => rule(subject));
  return Boolean(pageAccess[clean]?.(subject));
}

export function settingsPagesFor(user) {
  return settingsPaths.filter((path) => Boolean(pageAccess[path]?.(user)));
}

export function visibleNavigationPaths(roleOrUser, user) {
  const subject = subjectOf(roleOrUser, user);
  return [...Object.keys(pageAccess), "/settings"].filter((path) => canAccessNavigation(subject, path));
}

// Approvals is shown only to people with real approval authority: an approving role, a team that
// reports to them, or a step assigned to them now (e.g. covering a jefe on leave).
export function approvesRequests(user, pendingApprovals = 0) {
  if (userCan(user, P.REQUEST_APPROVE)) return true;
  return user?.hasTeam === true || user?.hasPendingApprovals === true || Number(pendingApprovals) > 0;
}

// Each role's menu (Manual de usuario, "Perfiles y menús"): its daily work only.
export const roleMenus = Object.freeze({
  [ROLES.SOLICITOR]: ["/", "/requests/new", "/requests", "/suppliers"],
  [ROLES.AREA_DIRECTOR]: ["/", "/requests", "/approvals", "/budget", "/reports"],
  [ROLES.VICE_RECTOR]: ["/", "/requests", "/approvals", "/budget", "/reports"],
  [ROLES.GAF]: ["/", "/approvals", "/accounting/bank-files", "/consultas", "/settings", "/treasury/transfers", "/investments", "/audit"],
  [ROLES.MANAGEMENT]: ["/", "/approvals", "/indicadores", "/consultas"],
  [ROLES.ACCOUNTING]: ["/", "/accounting/payables", "/treasury/statement-reviews", "/accounting/periods", "/consultas", "/settings"],
  [ROLES.TREASURY]: ["/", "/treasury", "/suppliers", "/treasury/history", "/treasury/statement-reviews", "/treasury/transfers", "/budget", "/consultas", "/settings"],
  [ROLES.LEGAL]: ["/", "/special-expenses", "/requests"],
  [ROLES.HUMAN_RESOURCES]: ["/", "/special-expenses"],
  [ROLES.AUDITOR]: ["/", "/consultas", "/audit", "/requests"],
  [ROLES.ADMIN]: ["/", "/users", "/administration/access", "/cost-centers", "/administration/audit", "/administration"]
});

export const roleNavigation = Object.freeze(Object.fromEntries(Object.entries(roleMenus).map(([role, paths]) => [role, paths.filter((path) => path !== "/settings").map((path) => [pageLabel(path, role), path])])));

// Pages a requester opens from the account menu instead of the sidebar: their own reimbursement
// bank account is a profile setting, not daily work.
export const accountMenuLabels = Object.freeze({ "/reimbursement-bank": "My bank account" });
export function accountMenuPaths(user) {
  if (!userCan(user, P.EMPLOYEE_BANK_MANAGE_OWN)) return [];
  return Object.keys(accountMenuLabels).filter((path) => canAccessNavigation(user, path));
}

// Primary navigation as [label, path] pairs: the menus of every role the person holds, merged in
// order, plus Approvals and My Team when they apply. Pages the person cannot open never appear.
export function navigationForUser(user, { pendingApprovals = 0 } = {}) {
  const paths = [];
  const add = (path) => { if (!paths.includes(path)) paths.push(path); };
  for (const role of rolesOf(user)) for (const path of roleMenus[role] || []) add(path);
  if (approvesRequests(user, pendingApprovals) && !paths.includes("/approvals")) paths.splice(Math.min(paths.length, 3), 0, "/approvals");
  if (user?.hasTeam === true) add("/my-team");
  const shown = paths.filter((path) => (path !== "/approvals" || approvesRequests(user, pendingApprovals)) && canAccessNavigation(user, path));
  // Settings is one entry; someone with a single settings page goes straight to it.
  const settingsAt = shown.indexOf("/settings");
  if (settingsAt >= 0) {
    const settings = settingsPagesFor(user);
    if (settings.length === 1) shown[settingsAt] = settings[0];
  }
  return shown.map((path) => [pageLabel(path, user), path]);
}

// Sidebar sections in display order. Every menu path belongs to one section and keeps this order
// whichever role added it, so the menu reads the same way for everyone.
export const navigationSections = Object.freeze([
  ["Overview", ["/"]],
  ["My work", ["/requests/new", "/requests", "/approvals", "/my-team", "/special-expenses", "/guides"]],
  ["Accounting", ["/accounting/payables", "/accounting", "/accounting/invoice-observations", "/batch-invoices", "/accounting/periods", "/accounting/sire"]],
  ["Treasury", ["/treasury", "/treasury/history", "/accounting/bank-files", "/treasury/statement-reviews", "/treasury/transfers", "/investments", "/reimbursement-bank"]],
  ["Queries", ["/budget", "/reports", "/consultas", "/indicadores", "/audit"]],
  ["Administration", ["/users", "/administration/access", "/cost-centers", "/administration/audit", "/administration", "/administration/alerts", "/administration/settings"]],
  ["Master Data", ["/suppliers", "/settings", ...settingsPaths.filter((path) => path !== "/cost-centers")]]
]);

function sectionOf(path) {
  const index = navigationSections.findIndex(([, paths]) => paths.includes(path));
  if (index >= 0) return index;
  if (path?.startsWith("/configuration/")) return navigationSections.findIndex(([label]) => label === "Master Data");
  return 0;
}

// Groups menu items (objects with a path) into the sections above, dropping empty sections.
export function groupNavigation(items) {
  const position = (path) => {
    const paths = navigationSections[sectionOf(path)][1];
    const at = paths.indexOf(path);
    return at < 0 ? paths.length : at;
  };
  return navigationSections
    .map(([label], index) => ({ label, items: items.filter((item) => sectionOf(item.path) === index).sort((left, right) => position(left.path) - position(right.path)) }))
    .filter((group) => group.items.length);
}

// Pages that sit under another page in the breadcrumb trail.
const pageParents = Object.freeze({
  "/requests/new": "/requests",
  "/treasury/history": "/treasury",
  "/treasury/transfers": "/treasury",
  "/administration/alerts": "/administration",
  "/administration/settings": "/administration",
  ...Object.fromEntries(settingsPaths.filter((path) => path !== "/cost-centers").map((path) => [path, "/settings"]))
});

export function homePath() {
  return "/";
}

// Breadcrumb trail for a location: [{ label, path }] from the home page down to the current page,
// whose entry has no path. Records use generic labels ("Request details", "Supplier record").
export function pageTrail(pathname, user) {
  const home = { label: pageLabel("/", user), path: "/" };
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return [{ label: home.label }];
  const request = path.match(/^\/requests\/([^/]+)(\/edit)?$/);
  if (request && request[1] !== "new") {
    const trail = [home, { label: pageLabel("/requests", user), path: "/requests" }];
    return request[2]
      ? [...trail, { label: "Request details", path: `/requests/${request[1]}` }, { label: "Edit request" }]
      : [...trail, { label: "Request details" }];
  }
  // The one-page approval the approval email opens.
  if (/^\/approvals\/[^/]+$/.test(path)) return [home, { label: pageLabel("/approvals", user), path: "/approvals" }, { label: "Your decision" }];
  const supplier = path.match(/^\/suppliers\/([^/]+)$/);
  if (supplier) return [home, { label: pageLabel("/suppliers", user), path: "/suppliers" }, { label: "Supplier record" }];
  const ancestors = [];
  for (let parent = pageParents[path]; parent && parent !== "/"; parent = pageParents[parent]) ancestors.unshift({ label: pageLabel(parent, user), path: parent });
  // Users without the Settings page itself (a single settings page) skip that level.
  const reachable = ancestors.filter((item) => item.path !== "/settings" || settingsPagesFor(user).length > 1);
  return [home, ...reachable, { label: pageLabel(path, user) || "Financial Control" }];
}

// Pending-task counters next to menu entries. Each path adds up the /dashboard/tasks counters
// of the work people act on from that page; a key the role does not receive counts as 0.
export const navigationCounterKeys = Object.freeze({
  "/approvals": ["approval"],
  "/treasury": ["payable", "paymentConfirmation"],
  "/accounting/payables": ["accounting"],
  "/accounting/invoice-observations": ["invoiceObservations"],
  "/budget": ["budgetExceptions", "budgetPlanChanges"],
  "/requests": ["corrections", "rendition"],
  // Tesorería validates new suppliers and their bank accounts.
  "/suppliers": ["suppliers", "supplierBankReviews"]
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

// Shorter labels where the menu label does not fit a bottom-bar slot.
export const bottomNavigationLabels = Object.freeze({
  "/accounting/invoice-observations": "Observations",
  "/treasury": "Payments",
  "/treasury/history": "History",
  "/treasury/transfers": "Transfers",
  "/treasury/statement-reviews": "Conciliaciones",
  "/budget": "Budget",
  "/administration/access": "Roles",
  "/administration": "Platform"
});

// Phone bottom bar: the first three destinations of the person's menu.
export function bottomNavigationForUser(user, options) {
  return navigationForUser(user, options).slice(0, 3).map(([label, path]) => ({ label: bottomNavigationLabels[path] || label, path }));
}

// Roles allowed to download a stored report file (generated/reports): fileAccessService "reports".
export const reportDownloadRoles = Object.freeze([ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR, ROLES.ACCOUNTING, ROLES.TREASURY, ROLES.MANAGEMENT, ROLES.GAF, ROLES.AUDITOR]);
