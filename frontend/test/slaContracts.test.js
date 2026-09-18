import assert from "node:assert/strict";
import fs from "node:fs";
const read = file => fs.readFileSync(new URL(file, import.meta.url), "utf8");
assert.ok(read("../src/pages/ApprovalInbox.jsx").includes("row.sla?.alert"));
assert.ok(read("../src/pages/Dashboard.jsx").includes("row.sla?.alert"));
const bell = read("../src/layouts/AppLayout.jsx");
for (const type of ["SLA_DUE_SOON", "SLA_OVERDUE", "SLA_ESCALATION"]) {
  assert.ok(bell.includes(type));
  assert.ok(read("../src/context/LanguageContext.jsx").includes(type));
}
console.log("PASS SLA severity appears in approval inbox, dashboard and existing notification bell");
