import { localeFor } from "./formatters.js";

// "My tasks" on the dashboard: the /dashboard/tasks items (also shown in the top-bar task panel)
// turned into one clear sentence each, most urgent first. English strings are the t() keys;
// Spanish lives in context/i18n/uxhome.js.

// [one, other] sentence per task key, or per `key:kind` when a role sees a variant of the task.
export const TASK_SENTENCES = {
  approval: ["{count} request to approve", "{count} requests to approve"],
  approvalEscalated: ["{count} request escalated past its SLA", "{count} requests escalated past their SLA"],
  drafts: ["{count} draft to finish", "{count} drafts to finish"],
  corrections: ["{count} request to correct", "{count} requests to correct"],
  "rendition:submit": ["{count} rendition to submit", "{count} renditions to submit"],
  "rendition:review": ["{count} rendition to review", "{count} renditions to review"],
  "rendition:outstanding": ["{count} rendition outstanding", "{count} renditions outstanding"],
  payable: ["{count} CXP ready to be paid", "{count} CXP ready to pay"],
  paymentConfirmation: ["{count} payment to confirm", "{count} payments to confirm"],
  bouncedPayments: ["{count} returned payment to reprogram", "{count} returned payments to reprogram"],
  employeeBankReviews: ["{count} reimbursement bank profile to verify", "{count} reimbursement bank profiles to verify"],
  supplierBankReviews: ["{count} supplier bank account to verify", "{count} supplier bank accounts to verify"],
  accounting: ["{count} request awaiting fiscal processing", "{count} requests awaiting fiscal processing"],
  suppliers: ["{count} supplier to homologate", "{count} suppliers to homologate"],
  missingExchangeRate: ["{count} date without an exchange rate", "{count} dates without an exchange rate"],
  period: ["The current accounting period is not open", "The current accounting period is not open"],
  "budgetExceptions:decide": ["{count} budget exception awaiting your decision", "{count} budget exceptions awaiting your decision"],
  "budgetExceptions:review": ["{count} budget exception pending", "{count} budget exceptions pending"],
  procurementOrders: ["{count} approved request awaiting a Purchase Order", "{count} approved requests awaiting a Purchase Order"]
};

// Details nested in a parent task (partOf), shown as small chips.
export const TASK_DETAILS = {
  approvalDueSoon: "{count} due soon",
  approvalEscalated: "{count} escalated"
};
// The parent task's own overdue count already says this.
const REDUNDANT_DETAILS = new Set(["approvalOverdue"]);

const TONE_RANK = { red: 0, amber: 1, teal: 2, navy: 2, neutral: 3 };
export const TONE_LABELS = { red: "Urgent", amber: "Needs attention", teal: "To do", navy: "To do", neutral: "To do" };

const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), text);

export function taskSentence(item, t = (text) => text) {
  const pair = TASK_SENTENCES[item.kind ? `${item.key}:${item.kind}` : item.key] || TASK_SENTENCES[item.key];
  if (!pair) return `${t(item.label)}: ${item.count}`;
  return fill(t(pair[item.count === 1 ? 0 : 1]), { count: item.count });
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

// "Due tomorrow", "Due on Thursday", "Next due on 12 October", "Was due yesterday", "2 past due".
export function taskDueLabel(item, { now = new Date(), language, t = (text) => text } = {}) {
  if (Number(item.overdue) > 0 && item.count > 1) return fill(t("{count} past due"), { count: item.overdue });
  if (!item.dueAt) return "";
  const due = new Date(item.dueAt);
  if (Number.isNaN(due.getTime())) return "";
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  const locale = localeFor(language);
  const day = Math.abs(days) <= 6
    ? new Intl.DateTimeFormat(locale, { weekday: "long" }).format(due)
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(due);
  if (due < now) return days === -1 ? t("Was due yesterday") : days === 0 ? t("Was due today") : fill(t("Was due on {day}"), { day });
  const next = item.count > 1 ? "Next due" : "Due";
  if (days === 0) return t(`${next} today`);
  if (days === 1) return t(`${next} tomorrow`);
  return fill(t(`${next} on {day}`), { day });
}

// Rows for the list: tasks with work, their nested details, most urgent first.
export function buildTaskList(items = [], { now = new Date(), language, t = (text) => text } = {}) {
  const details = items.filter((item) => item.partOf && item.count > 0 && !REDUNDANT_DETAILS.has(item.key));
  return items
    .filter((item) => !item.partOf && Number(item.count) > 0)
    .map((item) => ({
      key: item.key,
      path: item.path,
      tone: item.tone || "neutral",
      toneLabel: t(TONE_LABELS[item.tone] || "To do"),
      sentence: taskSentence(item, t),
      due: taskDueLabel(item, { now, language, t }),
      dueAt: item.dueAt || null,
      count: item.count,
      details: details.filter((detail) => detail.partOf === item.key).map((detail) => ({ key: detail.key, tone: detail.tone, text: fill(t(TASK_DETAILS[detail.key] || detail.label), { count: detail.count }) }))
    }))
    .sort((a, b) => (TONE_RANK[a.tone] ?? 3) - (TONE_RANK[b.tone] ?? 3)
      || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)
      || b.count - a.count);
}
