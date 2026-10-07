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

// Everyone who can open at least one Settings page.
export const settingsRoles = ["Admin", "Accounting", "Budget", "Treasury"];

export const navigationAccess = Object.freeze({
  "/": authenticatedRoles,
  "/management-view": ["Admin", "Management", "ManagementViewer"],
  "/requests": ["Admin", "Solicitor", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  "/my-team": internalRoles,
  "/requests/new": ["Admin", "Solicitor"],
  "/operations": internalRoles,
  "/settings": settingsRoles,
  "/treasury/history": ["Admin", "Treasury"],
  "/approvals": internalRoles,
  "/batch-invoices": ["Admin", "Solicitor", "Accounting"],
  "/accounting": ["Admin", "Accounting"],
  "/accounting/payables": ["Admin", "Accounting"],
  "/accounting/bank-files": ["Admin", "Accounting"],
  "/accounting/invoice-observations": ["Admin", "Accounting"],
  "/treasury": ["Admin", "Treasury"],
  "/reimbursement-bank": ["Admin", "Solicitor", "Accounting", "Treasury"],
  "/budget": ["Admin", "AreaDirector", "ViceRector", "Accounting", "Budget", "Management"],
  "/accounting/periods": ["Admin", "Accounting"],
  "/accounting/sire": ["Admin", "Accounting"],
  "/reports": ["Admin", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management"],
  // Every internal user can propose suppliers.
  "/suppliers": internalRoles,
  "/cost-centers": ["Admin", "Accounting"],
  "/expense-types": ["Admin", "Accounting"],
  "/exchange-rates": ["Admin", "Accounting"],
  "/users": ["Admin"],
  "/configuration/*": configurationRoles,
  ...Object.fromEntries(Object.entries(configurationAccess).map(([resource, roles]) => [`/configuration/${resource}`, roles]))
});

// Pages a permission granted in Administration > Users opens for that person, on top of their
// role. The backend enforces the same permissions on every call.
export const navigationGrants = Object.freeze({
  "/requests/new": ["request:create"],
  "/budget": ["budget:view"],
  "/reports": ["report:view"],
  "/management-view": ["management-portal:view"],
  "/reimbursement-bank": ["employee-bank:manage-own", "employee-bank:review"],
  "/batch-invoices": ["batch-invoice:upload", "batch-invoice:review"],
  "/accounting/invoice-observations": ["batch-invoice:review"],
  "/configuration/bank-formats": ["bank-format:certify"],
  "/settings": ["bank-format:certify"]
});

// The one list of page names. The sidebar, phone bar, command palette, breadcrumbs and the
// browser tab title all read their labels from here.
export const pageLabels = Object.freeze({
  "/": "Dashboard",
  "/requests": "Requests",
  "/requests/new": "New request",
  "/approvals": "Approvals",
  "/my-team": "My Team",
  "/operations": "Work review",
  "/batch-invoices": "A2 Batch Invoices",
  "/accounting/invoice-observations": "Invoice Observations",
  "/accounting/payables": "Accounts Payable",
  "/accounting/bank-files": "Bank File Verification",
  "/reimbursement-bank": "Reimbursement Banking",
  "/treasury": "Payments",
  "/treasury/history": "Payment History",
  "/accounting": "Accounting Entries",
  "/accounting/periods": "Accounting Periods",
  "/accounting/sire": "SIRE Export",
  "/budget": "Budget Control",
  "/reports": "Reports",
  "/management-view": "Management Portal",
  "/suppliers": "Suppliers",
  "/settings": "Settings",
  "/users": "Users",
  "/cost-centers": "Cost Centers",
  "/expense-types": "Accounting Accounts",
  "/exchange-rates": "Exchange Rates",
  "/configuration/approval-rules": "Approval Rules",
  "/configuration/direct-payment-eligibility": "Track B Eligibility",
  "/configuration/finance-configurations": "Finance Configurations",
  "/configuration/budget-rules": "Budget Rules",
  "/configuration/budget-allocations": "Budget Allocations",
  "/configuration/accounting-mappings": "Accounting Mappings",
  "/configuration/bank-formats": "Bank Formats"
});

// A requester only sees their own requests.
const roleLabels = Object.freeze({ Solicitor: { "/requests": "My Requests" } });

export function pageLabel(path, role) {
  return roleLabels[role]?.[path] || pageLabels[path] || "";
}

// Settings pages, grouped as on the Settings page. Each one keeps its own route.
export const settingsGroups = Object.freeze([
  ["Organization", ["/users", "/cost-centers"]],
  ["Finance", ["/expense-types", "/configuration/accounting-mappings", "/configuration/finance-configurations", "/exchange-rates"]],
  ["Approval and budget rules", ["/configuration/approval-rules", "/configuration/direct-payment-eligibility", "/configuration/budget-rules", "/configuration/budget-allocations"]],
  ["Banking", ["/configuration/bank-formats"]]
]);

export const settingsPaths = settingsGroups.flatMap(([, paths]) => paths);

export function hasGrant(user, ...permissions) {
  return permissions.some((permission) => (user?.permissions || []).includes(permission));
}

export function canAccessNavigation(role, path, user) {
  if (path === "/my-team" && user?.hasTeam !== true) return false;
  if (hasGrant(user, ...(navigationGrants[path] || []))) return true;
  if (path?.startsWith("/configuration/") && !navigationAccess[path]) return Boolean(role && navigationAccess["/configuration/*"].includes(role));
  return Boolean(role && navigationAccess[path]?.includes(role));
}

export function settingsPagesFor(user) {
  return settingsPaths.filter((path) => canAccessNavigation(user?.role, path, user));
}

export function visibleNavigationPaths(role, user) {
  return Object.entries(navigationAccess)
    .filter(([path]) => !path.endsWith("/*") && canAccessNavigation(role, path, user))
    .map(([path]) => path);
}

// Approvals follow the reporting line: a Solicitor approves only as someone's jefe, or when an
// approval step is assigned to them (e.g. covering a jefe on leave). Other roles that approve keep
// the entry. pendingApprovals is the live task counter, so an assignment shows up mid-session.
export function approvesRequests(user, pendingApprovals = 0) {
  if (user?.role !== "Solicitor") return true;
  return user.hasTeam === true || user.hasPendingApprovals === true || Number(pendingApprovals) > 0;
}

// Sidebar sections in display order. Every menu path belongs to one section and keeps this order
// whichever role or granted permission added it, so the menu reads the same way for everyone.
// Settings pages are listed under Master Data for people whose Settings is a single page.
export const navigationSections = Object.freeze([
  ["Overview", ["/"]],
  ["My work", ["/requests", "/requests/new", "/approvals", "/my-team", "/operations"]],
  ["Invoices and payables", ["/batch-invoices", "/accounting/invoice-observations", "/accounting/payables", "/accounting/bank-files", "/reimbursement-bank"]],
  ["Treasury", ["/treasury", "/treasury/history"]],
  ["Accounting", ["/accounting", "/accounting/periods", "/accounting/sire"]],
  ["Planning and reports", ["/budget", "/reports", "/management-view"]],
  ["Master Data", ["/suppliers", "/settings", ...settingsPaths]]
]);

// Each role's primary menu: deliberately smaller than the set of permitted routes. Admin gets
// every workspace; Settings and Suppliers are added below for everyone who can open them.
const adminMenu = navigationSections.flatMap(([, paths]) => paths).filter((path) => path !== "/my-team" && !settingsPaths.includes(path) && path !== "/settings" && path !== "/suppliers");
const roleMenus = {
  Solicitor: ["/", "/requests", "/requests/new", "/approvals"],
  AreaDirector: ["/", "/approvals", "/requests"],
  ViceRector: ["/", "/approvals", "/requests"],
  Budget: ["/", "/budget", "/requests"],
  Procurement: ["/", "/requests", "/suppliers", "/reports"],
  Accounting: ["/", "/accounting/payables", "/accounting/bank-files", "/batch-invoices", "/accounting/invoice-observations", "/accounting", "/accounting/periods", "/accounting/sire", "/operations"],
  Treasury: ["/", "/treasury", "/treasury/history", "/operations"],
  // Management also decides budget exceptions and budget changes above the approval threshold.
  Management: ["/", "/approvals", "/budget", "/reports", "/management-view"],
  // Portal only: no internal Reports, dashboards or request data.
  ManagementViewer: ["/management-view"],
  Admin: adminMenu
};

export const roleNavigation = Object.freeze(Object.fromEntries(Object.entries(roleMenus).map(([role, paths]) => [role, paths.map((path) => [pageLabel(path, role), path])])));

// Menu entries added for granted pages the role's own menu does not list.
const grantedNavigation = [
  ["/requests", ["request:create"]],
  ["/requests/new", ["request:create"]],
  ["/budget", ["budget:view"]],
  ["/reports", ["report:view"]],
  ["/management-view", ["management-portal:view"]],
  ["/reimbursement-bank", ["employee-bank:manage-own", "employee-bank:review"]],
  ["/batch-invoices", ["batch-invoice:upload", "batch-invoice:review"]],
  ["/accounting/invoice-observations", ["batch-invoice:review"]]
];

// Primary navigation as [label, path] pairs.
export function navigationForUser(user, { pendingApprovals = 0 } = {}) {
  const role = user?.role;
  const paths = (roleMenus[role] || []).filter((path) => path !== "/approvals" || approvesRequests(user, pendingApprovals));
  const add = (path) => { if (!paths.includes(path)) paths.push(path); };
  if (user?.hasTeam === true) add("/my-team");
  // Proposing suppliers is open to every internal user, so the menu always offers it.
  if (internalRoles.includes(role)) add("/suppliers");
  for (const [path, permissions] of grantedNavigation) if (hasGrant(user, ...permissions)) add(path);
  // Settings is one entry. Someone with a single settings page (Treasury: bank formats) goes
  // straight to it instead of a page with one link.
  const settings = settingsPagesFor(user);
  if (settings.length === 1) add(settings[0]);
  else if (settings.length > 1) add("/settings");
  return paths.filter((path) => canAccessNavigation(role, path, user)).map((path) => [pageLabel(path, role), path]);
}

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
  ...Object.fromEntries(settingsPaths.map((path) => [path, "/settings"]))
});

// Breadcrumb trail for a location: [{ label, path }] from the dashboard down to the current page,
// whose entry has no path. Records use generic labels ("Request details", "Supplier record").
export function pageTrail(pathname, user) {
  const role = user?.role;
  const home = { label: pageLabel("/", role), path: "/" };
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return [{ label: home.label }];
  const request = path.match(/^\/requests\/([^/]+)(\/edit)?$/);
  if (request && request[1] !== "new") {
    const requests = { label: pageLabel("/requests", role), path: "/requests" };
    return request[2]
      ? [home, requests, { label: "Request details", path: `/requests/${request[1]}` }, { label: "Edit request" }]
      : [home, requests, { label: "Request details" }];
  }
  const supplier = path.match(/^\/suppliers\/([^/]+)$/);
  if (supplier) return [home, { label: pageLabel("/suppliers", role), path: "/suppliers" }, { label: "Supplier record" }];
  const ancestors = [];
  for (let parent = pageParents[path]; parent; parent = pageParents[parent]) ancestors.unshift({ label: pageLabel(parent, role), path: parent });
  // Users without the Settings page itself (a single settings page) skip that level.
  const reachable = ancestors.filter((item) => item.path !== "/settings" || settingsPagesFor(user).length > 1);
  return [home, ...reachable, { label: pageLabel(path, role) || "Financial Control" }];
}

// Pending-task counters next to menu entries. Each path adds up the /dashboard/tasks counters
// of the work people act on from that page; a key the role does not receive counts as 0.
export const navigationCounterKeys = Object.freeze({
  "/approvals": ["approval"],
  "/treasury": ["payable", "paymentConfirmation"],
  "/accounting": ["accounting"],
  "/accounting/invoice-observations": ["invoiceObservations"],
  "/budget": ["budgetExceptions", "budgetPlanChanges"],
  "/requests": ["corrections", "rendition"],
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

// Phone bottom bar: up to three main destinations per role (from the role's menu), plus Search.
export const bottomNavigation = Object.freeze({
  Solicitor: ["/", "/requests", "/requests/new"],
  AreaDirector: ["/", "/approvals", "/requests"],
  ViceRector: ["/", "/approvals", "/requests"],
  Budget: ["/", "/budget", "/requests"],
  Procurement: ["/", "/requests", "/suppliers"],
  Accounting: ["/", "/accounting", "/accounting/invoice-observations"],
  Treasury: ["/", "/treasury", "/treasury/history"],
  Management: ["/", "/approvals", "/reports"],
  Admin: ["/", "/requests", "/settings"]
});

// Shorter labels where the menu label does not fit a bottom-bar slot.
export const bottomNavigationLabels = Object.freeze({
  "/accounting/invoice-observations": "Observations",
  "/treasury/history": "History",
  "/budget": "Budget"
});

export function bottomNavigationForUser(user, options) {
  const items = navigationForUser(user, options);
  // A requester who also approves for a team gets Approvals in place of the request list.
  const paths = user?.role === "Solicitor" && user?.hasTeam === true ? ["/", "/approvals", "/requests/new"] : bottomNavigation[user?.role];
  const chosen = paths ? paths.map((path) => items.find(([, itemPath]) => itemPath === path)).filter(Boolean) : items.slice(0, 3);
  return chosen.slice(0, 3).map(([label, path]) => ({ label: bottomNavigationLabels[path] || label, path }));
}
