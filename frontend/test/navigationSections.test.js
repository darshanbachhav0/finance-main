import assert from "node:assert/strict";
import { authenticatedRoles, groupNavigation, navigationForUser, navigationSections } from "../src/utils/navigationAccess.js";

// The sidebar groups every role's menu into the same fixed sections, in the same order.
const grouped = (user) => groupNavigation(navigationForUser(user).map(([label, path]) => ({ label, path })));
const order = navigationSections.map(([label]) => label);
for (const role of authenticatedRoles) {
  const groups = grouped({ role, hasTeam: true, hasPendingApprovals: true });
  assert.ok(groups.length > 0, `${role} has a menu`);
  assert.deepEqual(groups.map((group) => group.label), order.filter((label) => groups.some((group) => group.label === label)), `${role} sections keep their order`);
  assert.ok(groups.every((group) => group.items.length > 0), `${role} has no empty section`);
  const flat = groups.flatMap((group) => group.items.map((item) => item.path));
  assert.deepEqual([...flat].sort(), navigationForUser({ role, hasTeam: true, hasPendingApprovals: true }).map(([, path]) => path).sort(), `${role} keeps every menu entry`);
}
const accounting = grouped({ role: "Accounting" });
assert.deepEqual(accounting.map((group) => group.label), ["Overview", "Finance", "Planning and reports", "Master Data"]);
assert.deepEqual(accounting.find((group) => group.label === "Finance").items.map((item) => item.path), ["/accounting", "/accounting/payables", "/accounting/invoices", "/accounting/invoice-observations"]);
// A permission-granted page lands in its section, not at the end of the list.
const treasuryRequester = grouped({ role: "Treasury", permissions: ["request:create"] });
assert.deepEqual(treasuryRequester.find((group) => group.label === "Requests").items.map((item) => item.path), ["/requests", "/requests/new"]);
assert.equal(treasuryRequester[1].label, "Requests", "Requests comes right after Overview");
console.log("PASS The sidebar groups every role's menu into fixed sections in a stable order.");
