import assert from "node:assert/strict";
import fs from "node:fs";
import uxshellSpanish from "../src/context/i18n/uxshell.js";
import { bottomNavigationForUser, counterBadgeText, navigationCount, navigationForUser } from "../src/utils/navigationAccess.js";
import { minutesLeft, sessionExpiresAt, sessionPhase, tokenExpiresAt, SESSION_WARNING_LEAD_MS } from "../src/utils/sessionExpiry.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("../src/styles/global.css");
const shellCss = css.slice(css.indexOf("/* ==== ux: app shell"));

// 1. Menu counters come from the /dashboard/tasks counters.
const counters = { approval: 3, payable: 2, paymentConfirmation: 1, invoiceObservations: 150, budgetExceptions: 0, rendition: 1, requestCorrections: 2, accounting: -1 };
assert.equal(navigationCount("/approvals", counters), 3);
assert.equal(navigationCount("/treasury", counters), 3, "payments ready plus payments awaiting confirmation");
assert.equal(navigationCount("/accounting/invoice-observations", counters), 150);
assert.equal(navigationCount("/budget", counters), 0);
assert.equal(navigationCount("/requests", counters), 3, "returned requests plus outstanding renditions");
assert.equal(navigationCount("/accounting", counters), 0, "a bad value never shows a badge");
assert.equal(navigationCount("/reports", counters), 0);
assert.equal(navigationCount("/approvals", undefined), 0);
assert.equal(counterBadgeText(0), "");
assert.equal(counterBadgeText(7), "7");
assert.equal(counterBadgeText(99), "99");
assert.equal(counterBadgeText(100), "99+");
assert.equal(uxshellSpanish["{count} pending items"], "{count} pendientes");

const layout = source("../src/layouts/AppLayout.jsx");
assert.match(layout, /navigationCount\(item\.path, tasks\.counters\)/, "sidebar counters use the shared mapping");
assert.match(layout, /aria-label=\{name\}/, "the link's accessible name includes the count (also when the sidebar is collapsed)");
assert.match(layout, /className="nav-counter" aria-hidden="true">\{counterBadgeText\(count\)\}/);
assert.match(shellCss, /\.sidebar-collapsed \.nav-counter \{/, "the collapsed sidebar keeps a visible badge");

// 2. Session expiry warning.
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const exp = Math.floor(Date.UTC(2026, 8, 29, 18, 0, 0) / 1000);
const token = `${encode({ alg: "HS256" })}.${encode({ id: "u1", exp })}.signature`;
assert.equal(tokenExpiresAt(token), exp * 1000);
assert.equal(tokenExpiresAt("not-a-token"), null);
assert.equal(tokenExpiresAt(`${encode({})}.%%%.x`), null);
assert.equal(sessionExpiresAt({ token, expiresAt: "2026-09-29T19:00:00.000Z" }), Date.parse("2026-09-29T19:00:00.000Z"), "the server's expiresAt wins");
assert.equal(sessionExpiresAt({ token }), exp * 1000);
assert.equal(SESSION_WARNING_LEAD_MS, 5 * 60 * 1000);
assert.equal(sessionPhase(exp * 1000, exp * 1000 - 6 * 60000), "hidden");
assert.equal(sessionPhase(exp * 1000, exp * 1000 - 5 * 60000), "warning");
assert.equal(sessionPhase(exp * 1000, exp * 1000), "expired");
assert.equal(sessionPhase(null, Date.now()), "hidden");
assert.equal(minutesLeft(exp * 1000, exp * 1000 - 5 * 60000), 5);
assert.equal(minutesLeft(exp * 1000, exp * 1000 - 10000), 1);
assert.equal(uxshellSpanish["Your session expires in {minutes} minutes"].replace("{minutes}", 5), "Tu sesión vence en 5 minutos");
assert.equal(uxshellSpanish["Keep me signed in"], "Seguir conectado");
assert.equal(uxshellSpanish["Sign out now"], "Cerrar sesión");
const auth = source("../src/context/AuthContext.jsx");
assert.match(auth, /api\.post\("\/auth\/refresh"\)/, "Stay signed in asks the server for a fresh token");
assert.match(auth, /phase === "warning"[\s\S]*flushAllDrafts\(\)/, "drafts are saved when the warning appears");
assert.match(auth, /<SessionExpiryNotice/);
const extendBody = auth.slice(auth.indexOf("async function extendSession"), auth.indexOf("async function login"));
assert.equal(extendBody.includes("clearDraftSessions"), false, "extending the session keeps open drafts");
const notice = source("../src/components/SessionExpiryNotice.jsx");
assert.match(notice, /aria-modal="false"/, "the notice does not block the page");

// 3. Compact brand area; the dark theme no longer shows a white rectangle.
assert.match(shellCss, /^\.brand \{ min-height: 76px; height: 76px;/m);
assert.match(shellCss, /\[data-theme="dark"\] \.brand \.uma-logo-full, \[data-theme="dark"\] \.brand \.uma-logo-symbol \{[^}]*background: transparent;[^}]*filter: invert\(1\)/);
assert.match(shellCss, /\.sidebar-collapsed \.brand \{ min-height: 76px;/, "the collapsed sidebar keeps the symbol");

// 4. Checkboxes: 22px box inside a 40px tap area on phones.
assert.match(shellCss, /@media \(max-width: 760px\) \{[\s\S]*input\[type="checkbox"\]:not\(\.sr-only\) \{[^}]*width: var\(--touch-target\); height: var\(--touch-target\); margin: -9px;/);
assert.match(shellCss, /input\[type="checkbox"\]:not\(\.sr-only\)::before \{[^}]*inset: 9px;/, "the drawn box stays 40 - 2 x 9 = 22px");
assert.match(shellCss, /:checked::before \{[^}]*var\(--checkbox-check\)/);
assert.match(shellCss, /:focus-visible::before \{/, "keyboard focus stays visible");

// 5. Phone bottom navigation.
const destinations = (user) => bottomNavigationForUser(user).map((item) => item.path);
assert.deepEqual(destinations({ role: "Solicitor" }), ["/", "/requests", "/requests/new"]);
assert.deepEqual(destinations({ role: "Solicitor", hasTeam: true }), ["/", "/approvals", "/requests/new"]);
assert.deepEqual(destinations({ role: "AreaDirector" }), ["/", "/approvals", "/requests"]);
assert.deepEqual(destinations({ role: "Treasury" }), ["/", "/treasury", "/treasury/history"]);
assert.deepEqual(destinations({ role: "Accounting" }), ["/", "/accounting", "/accounting/invoice-observations"]);
assert.deepEqual(destinations({ role: "ManagementViewer" }), ["/management-view"]);
for (const role of ["Admin", "Solicitor", "AreaDirector", "ViceRector", "Accounting", "Treasury", "Budget", "Procurement", "Management", "ManagementViewer"]) {
  const allowed = navigationForUser({ role }).map(([, path]) => path);
  for (const path of destinations({ role })) assert.ok(allowed.includes(path), `${role}: ${path} is one of the role's menu entries`);
  assert.ok(destinations({ role }).length <= 3, `${role}: at most three destinations plus Search`);
}
const bottomNav = source("../src/components/MobileBottomNav.jsx");
assert.match(bottomNav, /\(max-width: 640px\)/);
assert.match(bottomNav, /\[role="dialog"\]\[aria-modal="true"\]/, "hidden while a dialog or drawer is open");
assert.match(bottomNav, /visualViewport/, "hidden while the on-screen keyboard is open");
assert.match(layout, /<MobileBottomNav[\s\S]*onSearch=\{managementViewer \? undefined : openCommandPalette\}/, "Search opens the command palette");
assert.match(layout, /suppressed=\{mobileOpen \|\| commandOpen\}/);
assert.match(shellCss, /padding: var\(--space-1\) var\(--space-1\) env\(safe-area-inset-bottom, 0px\)/, "safe-area padding");
assert.match(shellCss, /\.app-shell:has\(\.mobile-bottom-nav\) \.content \{ padding-bottom: calc\(var\(--bottom-nav-offset\)/, "content is never hidden behind the bar");
assert.match(shellCss, /\.app-shell:has\(\.mobile-bottom-nav:not\(\.is-hidden\)\) \.wizard-actions \{ bottom: var\(--bottom-nav-offset\); \}/);

// 6. Request detail: the page's main action in a bar above the bottom navigation.
const detail = source("../src/pages/RequestDetail.jsx");
assert.match(detail, /const stickyAction = permissions\.canApprove/);
assert.match(detail, /onClick: \(\) => decision\("approve", false\)/, "reuses the approval handler");
assert.match(detail, /onClick: submitRequest/, "reuses the submit handler");
assert.match(detail, /onClick=\{confirmCommitBudget\}/, "the action panel and the bar share one handler");
assert.match(detail, /className="request-sticky-actions"/);
assert.match(shellCss, /\.app-shell:has\(\.mobile-bottom-nav:not\(\.is-hidden\)\) \.request-sticky-actions \{ bottom: var\(--bottom-nav-offset\);/);

console.log("PASS app shell: menu counters, session expiry warning, compact brand, checkbox tap areas, phone bottom bar, request action bar");
