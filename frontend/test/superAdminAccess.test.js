import assert from "node:assert/strict";
import fs from "node:fs";
import { canAccessNavigation, navigationForUser, pageTrail, superAdminConsolePaths } from "../src/utils/navigationAccess.js";
import { isReadOnlyRole, readOnlyMayCall, READ_ONLY_WRITE_PATHS } from "../src/utils/readOnly.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const menu = (user) => navigationForUser(user).map(([, path]) => path);

// 1. The console is the Super Admin's only; it opens the Admin's workspaces read-only, never the
//    pages whose purpose is to act (new request, approvals, work review, uploads, my team, leave).
for (const path of superAdminConsolePaths) {
  assert.equal(canAccessNavigation("SuperAdmin", path), true, path);
  assert.equal(canAccessNavigation("Admin", path), false, `Admin has no ${path}`);
}
const superAdmin = menu({ role: "SuperAdmin", hasTeam: true });
for (const path of ["/super-admin", "/requests", "/treasury", "/accounting/payables", "/budget", "/reports", "/suppliers", "/settings"]) assert.ok(superAdmin.includes(path), `Super Admin menu has ${path}`);
for (const path of ["/", "/requests/new", "/approvals", "/operations", "/batch-invoices", "/reimbursement-bank", "/my-team"]) {
  assert.ok(!superAdmin.includes(path), `Super Admin menu has no ${path}`);
}
for (const path of ["/requests/new", "/approvals", "/operations", "/batch-invoices", "/my-team"]) assert.equal(canAccessNavigation("SuperAdmin", path, { role: "SuperAdmin", hasTeam: true }), false, path);
assert.deepEqual(pageTrail("/super-admin/audit", { role: "SuperAdmin" }).map((item) => item.label), ["Platform overview", "Audit log"], "the trail starts at the console");

// 2. Read-only: writes are stopped in the browser except the console and personal settings, the
//    same list the backend allows (backend/src/middleware/auth.js SUPER_ADMIN_WRITE_PATHS).
assert.equal(isReadOnlyRole("SuperAdmin"), true);
assert.equal(isReadOnlyRole("Admin"), false);
assert.equal(readOnlyMayCall("get", "/requests"), true);
assert.equal(readOnlyMayCall("post", "/requests"), false);
assert.equal(readOnlyMayCall("put", "/users/123"), false);
assert.equal(readOnlyMayCall("post", "/superadmin/administrators"), true);
assert.equal(readOnlyMayCall("patch", "/notifications/abc/read"), true);
const backendAuth = read("../../backend/src/middleware/auth.js");
const backendPaths = JSON.parse(backendAuth.match(/SUPER_ADMIN_WRITE_PATHS = Object\.freeze\((\[[^\]]+\])\)/)[1]).map((path) => path.replace(/^\/api/, ""));
assert.deepEqual([...backendPaths].sort(), READ_ONLY_WRITE_PATHS.filter((path) => path !== "/auth/").sort(), "browser and server allow the same writes");

// 3. Shared components and the pages whose actions were not role-gated hide them for read-only users.
assert.match(read("../src/components/ResourceManager.jsx"), /const canCreate = !readOnlyUser && /);
assert.match(read("../src/api/client.js"), /isReadOnlyRole\(storedRole\(\)\) && !readOnlyMayCall/);
for (const page of ["AccountingPeriods", "BankFileVerification", "AccountsPayable", "AccountingEntries", "InvoiceObservations", "SireExport", "TreasuryQueue", "Suppliers"]) {
  assert.match(read(`../src/pages/${page}.jsx`), /readOnly/, `${page} hides its actions for read-only users`);
}
assert.match(read("../src/components/SupplierCreditsPanel.jsx"), /readOnly \|\| row\.status === "SETTLED" \? \[\]/);
assert.match(read("../src/layouts/AppLayout.jsx"), /!managementViewer && !readOnly && <button/, "no leave for the Super Admin");

// 4. Routes: the console and the sign-in steps.
const app = read("../src/App.jsx");
assert.match(app, /<Route path="super-admin" element=\{<ProtectedRoute roles=\{\["SuperAdmin"\]\} \/>\}>/);
assert.match(app, /if \(user\?\.role === "SuperAdmin"\) return <Navigate to="\/super-admin" replace \/>;/);
assert.match(read("../src/routes/ProtectedRoute.jsx"), /user\.twoFactorSetupRequired/);
const login = read("../src/pages/Login.jsx");
assert.match(login, /verifyTwoFactor\(code\)/);
assert.match(login, /enableTwoFactor\(code\)/);

console.log("PASS Super Admin: console routes, read-only menu, browser/server write allow-list, actions hidden on ungated pages, sign-in steps");
