import assert from "node:assert/strict";
import fs from "node:fs";
import { canAccessNavigation, roleNavigation } from "../src/utils/navigationAccess.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../src/pages/ExternalManagementPortal.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/layouts/AppLayout.jsx", import.meta.url), "utf8");

// ManagementViewer sees only the management portal: no internal Reports, dashboards or data.
assert.deepEqual(roleNavigation.ManagementViewer, [["Management Portal", "/management-view"]]);
assert.equal(canAccessNavigation("ManagementViewer", "/management-view"), true);
for (const path of ["/reports", "/my-team", "/requests", "/approvals", "/budget", "/accounting", "/treasury", "/administration", "/configuration/bank-formats"]) {
  assert.equal(canAccessNavigation("ManagementViewer", path), false, `${path} is outside the read-only viewer scope`);
}
assert.match(app, /user\?\.role === "ManagementViewer"/);
assert.match(app, /roles=\{\["Admin", "Management", "ManagementViewer"\]\}/);
// The portal route is the only one that names ManagementViewer.
assert.equal(app.match(/ManagementViewer/g).length, 2);
assert.match(app, /roles=\{internalRoles\}/);
assert.match(layout, /useNotificationBell\(user\._id, !managementViewer\)/);
for (const endpoint of ["overview", "budget", "workflow", "payments", "sla", "filters"]) assert.match(portal, new RegExp(`"${endpoint}"`));
for (const forbidden of ["/requests/", "/files/", "/treasury", "/accounting", "supplierName", "requestNumber", "accountNumber", "cci"]) assert.equal(portal.includes(forbidden), false, `${forbidden} is absent from the portal`);
console.log("PASS isolated, read-only Management Viewer portal contract");
