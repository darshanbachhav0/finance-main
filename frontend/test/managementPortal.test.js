import assert from "node:assert/strict";
import fs from "node:fs";
import { canAccessNavigation, roleNavigation } from "../src/utils/navigationAccess.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../src/pages/ExternalManagementPortal.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/layouts/AppLayout.jsx", import.meta.url), "utf8");

assert.deepEqual(roleNavigation.ManagementViewer, [["Management Portal", "/management-view"]]);
assert.equal(canAccessNavigation("ManagementViewer", "/management-view"), true);
for (const path of ["/requests", "/approvals", "/budget", "/accounting", "/treasury", "/reports", "/administration", "/audit"]) {
  assert.equal(canAccessNavigation("ManagementViewer", path), false, `${path} is outside the viewer portal`);
}
assert.match(app, /user\?\.role === "ManagementViewer"/);
assert.match(app, /roles=\{\["Admin", "Management", "ManagementViewer"\]\}/);
assert.match(app, /roles=\{internalRoles\}/);
assert.match(layout, /useNotificationBell\(user\._id, !managementViewer\)/);
for (const endpoint of ["overview", "budget", "workflow", "payments", "sla", "filters"]) assert.match(portal, new RegExp(`"${endpoint}"`));
for (const forbidden of ["/requests/", "/files/", "/treasury", "/accounting", "supplierName", "requestNumber", "accountNumber", "cci"]) assert.equal(portal.includes(forbidden), false, `${forbidden} is absent from the portal`);
console.log("PASS isolated, read-only Management Viewer portal contract");
