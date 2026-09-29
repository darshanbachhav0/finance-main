import assert from "node:assert/strict";
import fs from "node:fs";
import { TASK_DETAILS, TASK_SENTENCES, buildTaskList, taskDueLabel, taskSentence } from "../src/utils/myTasks.js";
import { canAccessNavigation } from "../src/utils/navigationAccess.js";
import uxhomeSpanish from "../src/context/i18n/uxhome.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const backend = (path) => read(`../../backend/src/${path}`);
const es = (text) => uxhomeSpanish[text] ?? text;

// 1. Every task reads as one sentence with its count, in English and Spanish.
assert.equal(taskSentence({ key: "approval", count: 3 }), "3 requests to approve");
assert.equal(taskSentence({ key: "approval", count: 3 }, es), "3 solicitudes por aprobar");
assert.equal(taskSentence({ key: "approval", count: 1 }, es), "1 solicitud por aprobar");
assert.equal(taskSentence({ key: "payable", count: 5 }, es), "5 CXP listas para pagar");
assert.equal(taskSentence({ key: "rendition", kind: "submit", count: 1 }, es), "1 rendición por presentar");
assert.equal(taskSentence({ key: "rendition", kind: "review", count: 2 }, es), "2 rendiciones por revisar");
assert.equal(taskSentence({ key: "budgetExceptions", kind: "decide", count: 2 }, es), "2 excepciones presupuestales pendientes de su decisión");
assert.equal(taskSentence({ key: "unknownTask", label: "Something new", count: 4 }), "Something new: 4", "an unknown task still shows its label and count");
for (const [one, other] of Object.values(TASK_SENTENCES)) {
  assert.ok(uxhomeSpanish[one] && uxhomeSpanish[other], `Spanish copy for "${one}" / "${other}"`);
}
for (const text of [...Object.values(TASK_DETAILS), "{count} past due", "Due today", "Due tomorrow", "Due on {day}", "Next due today", "Next due tomorrow", "Next due on {day}", "Was due yesterday", "Was due today", "Was due on {day}", "My tasks", "All caught up", "Nothing needs your attention right now.", "Urgent", "Needs attention", "To do"]) {
  assert.ok(uxhomeSpanish[text], `Spanish copy for "${text}"`);
}

// 2. Deadlines read as "due Thursday"; overdue work says so.
const monday = new Date(2026, 8, 28, 10, 0);
const thursday = new Date(2026, 9, 1, 17, 0);
assert.equal(taskDueLabel({ count: 1, dueAt: thursday }, { now: monday, language: "es", t: es }), "Vence el jueves");
assert.equal(taskDueLabel({ count: 3, dueAt: thursday }, { now: monday, language: "en" }), "Next due on Thursday");
assert.equal(taskDueLabel({ count: 1, dueAt: new Date(2026, 8, 29, 9, 0) }, { now: monday, language: "es", t: es }), "Vence mañana");
assert.equal(taskDueLabel({ count: 1, overdue: 1, dueAt: new Date(2026, 8, 27, 9, 0) }, { now: monday, language: "es", t: es }), "Venció ayer");
assert.equal(taskDueLabel({ count: 4, overdue: 2, dueAt: new Date(2026, 8, 20) }, { now: monday, language: "es", t: es }), "2 vencidas");
assert.match(taskDueLabel({ count: 1, dueAt: new Date(2026, 10, 15) }, { now: monday, language: "es", t: es }), /^Vence el 15 de noviembre$/);
assert.equal(taskDueLabel({ count: 2 }, { now: monday }), "", "no deadline, no label");

// 3. The list keeps only work to do, nests SLA details and puts the most urgent first.
const rows = buildTaskList([
  { key: "drafts", label: "Drafts to finish", count: 2, path: "/requests?status=BORRADOR", tone: "neutral" },
  { key: "approval", label: "Requests awaiting approval", count: 3, path: "/approvals", tone: "amber", dueAt: thursday, overdue: 0 },
  { key: "approvalOverdue", count: 0, partOf: "approval", tone: "red" },
  { key: "approvalDueSoon", count: 1, partOf: "approval", tone: "amber" },
  { key: "rendition", kind: "submit", label: "Renditions to submit", count: 1, path: "/requests/abc", tone: "red", dueAt: new Date(2026, 8, 27), overdue: 1 },
  { key: "corrections", label: "Requests to correct", count: 0, path: "/requests", tone: "red" }
], { now: monday, language: "es", t: es });
assert.deepEqual(rows.map((row) => row.key), ["rendition", "approval", "drafts"], "urgent first; nothing with a zero count; nested details are not rows");
assert.equal(rows[0].path, "/requests/abc", "a single record opens directly");
assert.equal(rows[0].due, "Venció ayer");
assert.deepEqual(rows[1].details.map((detail) => detail.text), ["1 por vencer"]);
assert.equal(rows[1].due, "La próxima vence el jueves");
assert.equal(buildTaskList([{ key: "approval", count: 2, tone: "red", overdue: 2 }, { key: "approvalOverdue", count: 2, partOf: "approval", tone: "red" }])[0].details.length, 0, "the overdue detail repeats the parent's own overdue count");
assert.deepEqual(buildTaskList([]), []);

// 4. The dashboard opens with "My tasks" instead of the generic banner; each role keeps its
//    primary action, and that action is a page the role can open.
const dashboard = read("../src/pages/Dashboard.jsx");
assert.match(dashboard, /<MyTasks items=\{summary\.tasks\?\.items\}/);
assert.doesNotMatch(dashboard, /dashboard-next|Keep university operations moving/);
const actions = [...dashboard.matchAll(/^\s+(\w+): \[(AWAITING_PURCHASE_ORDER_PATH|"[^"]+"), "([^"]+)"\]/gm)].map(([, role, path, label]) => ({ role, path: path === "AWAITING_PURCHASE_ORDER_PATH" ? "/requests" : JSON.parse(path), label }));
assert.equal(actions.length, 9, "every internal role has a primary action");
for (const action of actions) assert.ok(canAccessNavigation(action.role, action.path.split("?")[0]), `${action.role} can open ${action.path}`);
assert.deepEqual(actions.find((action) => action.role === "Solicitor"), { role: "Solicitor", path: "/requests/new", label: "New request" });
const myTasks = read("../src/components/MyTasks.jsx");
assert.match(myTasks, /All caught up/);
assert.match(myTasks, /to=\{row\.path\}/, "each task opens its record or filtered list");

// 5. The backend tasks carry the real work of each role and link to exact records.
const controller = backend("controllers/dashboardController.js");
for (const token of ['key: "drafts"', 'key: "corrections"', 'key: "bouncedPayments"', '"rendition.dueAt"', "`/approvals?request=${record._id}`", "`/requests/${record._id}/edit`", "`/treasury?tab=prepare&record=${record._id}`", "partOf: \"approval\"", 'BUDGET_EXCEPTION_DECISIONS_PATH = "/approvals#budget-exceptions"']) {
  assert.ok(controller.includes(token), `dashboard tasks include ${token}`);
}
for (const label of ["Drafts to finish", "Requests to correct", "Renditions to submit", "Renditions to review", "Returned payments to reprogram"]) {
  assert.ok(controller.includes(`"${label}"`) && uxhomeSpanish[label], `${label} is a task label with Spanish copy`);
}

// 6. Management decides reviewed budget exceptions in the Approval Inbox.
const inbox = read("../src/pages/ApprovalInbox.jsx");
assert.match(inbox, /useBudgetExceptionDecisions\(\)/);
assert.match(inbox, /<BudgetExceptionDecisions queue=\{exceptionDecisions\} \/>/);
assert.match(inbox, /summary\.total \+ exceptionDecisions\.total/, "the header stats show the combined count");
const decisions = read("../src/components/BudgetExceptionDecisions.jsx");
assert.match(decisions, /"\/dashboard\/decisions\/budget-exceptions"/);
assert.match(decisions, /api\.post\(`\/budget\/exceptions\/\$\{confirm\.row\._id\}\/decision`, \{ status: confirm\.status, comments \}\)/, "decisions use the existing budget-exception API");
assert.match(decisions, /BUDGET_EXCEPTION_DECISION_ROLES = \["Management", "Admin"\]/);
assert.match(decisions, /hidden: !row\.canDecide/, "only rows the server lets this user decide offer approve/reject");
assert.match(decisions, /id="budget-exceptions"/);
assert.match(backend("routes/dashboardRoutes.js"), /router\.get\("\/decisions\/budget-exceptions", authorize\(ROLES\.ADMIN, ROLES\.MANAGEMENT\)/);
assert.match(read("../src/styles/global.css"), /\/\* ==== ux: role home ==== \*\/[\s\S]*\.my-task \{/);

console.log("PASS my tasks: role task sentences, deadlines, urgency order, primary actions and the Management budget-exception decisions");
