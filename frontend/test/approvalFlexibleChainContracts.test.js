import assert from "node:assert/strict";
import fs from "node:fs";
import approvalsSpanish from "../src/context/i18n/approvals.js";

const read = file => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const inbox = read("../src/pages/ApprovalInbox.jsx");
const detail = read("../src/pages/RequestDetail.jsx");
const list = read("../src/pages/RequestsList.jsx");
const team = read("../src/pages/MyTeam.jsx");
const users = read("../src/pages/AdminUsers.jsx");

// Finalize is always offered on a chain step; "Send to my jefe" only when the server says so.
assert.ok(inbox.includes("row.approvalOptions?.canForward"));
assert.ok(inbox.includes('openDecision(row, "approve", true)') && inbox.includes('openDecision(row, "approve", isChainRow(row) ? false : undefined)'));
assert.ok(inbox.includes('t("Send to my jefe")'), "the inbox column shows both buttons");
assert.ok(detail.includes("/approvals/${id}/options") && detail.includes('decision("approve", true)') && detail.includes('decision("approve", false)'));
// Withdrawal from the detail page and the list row menu.
assert.ok(detail.includes("/requests/${id}/withdraw") && detail.includes('actions.has("WITHDRAW")'));
assert.ok(list.includes("/withdraw") && list.includes('includes("WITHDRAW")'));
// My Team only links rows the server marks viewable.
assert.ok(team.includes("row.canView ?"));
// Admin can put a user on leave.
assert.ok(users.includes('name: "onLeave"'));
for (const key of ["Send to my jefe", "Withdraw", "Withdraw request", "On leave", "Request approved"]) assert.ok(approvalsSpanish[key], `Spanish copy for ${key}`);

console.log("PASS flexible chain, withdrawal, My Team links and leave UI contracts");
