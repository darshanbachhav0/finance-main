import assert from "node:assert/strict";
import { dashboardMetricLink } from "../src/utils/dashboardLinks.js";
import { authenticatedRoles, canAccessNavigation } from "../src/utils/navigationAccess.js";

const keys = ["requests", "users", "workflow", "supplierWarnings", "blocked", "drafts", "returned", "pending", "rendition", "closed", "amount", "oldest", "overdue", "spend", "capex", "opex", "available", "commitments", "period", "cxp", "debit", "credit", "closure", "queue", "pen", "usd", "missingBank", "files", "assigned", "committed", "executed", "paid"];
for (const role of authenticatedRoles) {
  for (const key of keys) {
    const { to } = dashboardMetricLink(role, key);
    assert.ok(!to || canAccessNavigation(role, to.split("?")[0]), `${role}: ${key} must respect navigation permissions`);
  }
}
assert.equal(dashboardMetricLink("Solicitor", "drafts").to, "/requests?status=BORRADOR");
assert.equal(dashboardMetricLink("Solicitor", "closed").to, "/requests?status=CERRADO");
assert.equal(dashboardMetricLink("Solicitor", "rendition").to, "/requests?renditionStatus=PENDING%2CSUBMITTED%2COBSERVED");
assert.equal(dashboardMetricLink("AreaDirector", "pending").to, "/approvals");
assert.equal(dashboardMetricLink("ViceRector", "pending").to, "/approvals");
assert.equal(dashboardMetricLink("Accounting", "cxp").to, "/accounting/payables");
assert.equal(dashboardMetricLink("Treasury", "pen").to, "/treasury");
assert.deepEqual(dashboardMetricLink("Unknown", "requests"), {});
console.log("PASS dashboard links: role access, draft/closed status filters and operational queues");
