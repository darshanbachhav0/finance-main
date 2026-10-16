import FinancialRequest from "../models/FinancialRequest.js";
import WorkDraft from "../models/WorkDraft.js";
import { workingDaysBetween } from "./businessCalendarService.js";
import { notificationText, notifyRoles, notifyUser } from "./notificationService.js";
import { nextPaymentRunSummary } from "./treasuryService.js";
import { transitionRequest } from "./workflowService.js";
import { REQUEST_STATUS, ROLES } from "../utils/constants.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";

// Automatic follow-ups, run by the operations worker:
// - a request sent back to its requester and not corrected gets a reminder after
//   FOLLOW_UP_RETURNED_WORKING_DAYS working days (default 2) and again after twice that;
// - a draft nobody touched for DRAFT_AUTO_CLOSE_DAYS days (default 30, 0 = never) is closed: a
//   saved draft request is annulled (audited, nothing was committed yet) and an unsaved form draft
//   leaves "Continue your work". The owner is warned DRAFT_CLOSE_WARNING_DAYS days before (default 5);
// - Treasury is told PAYMENT_RUN_NOTICE_WORKING_DAYS working days (default 2) before each 15th /
//   30th payment run what falls into it, with a link that prepares it in one click.
// Every reminder has its own event key, so running the scan again never repeats one.

const DAY_MS = 86400000;
const SYSTEM_ACTOR = Object.freeze({ name: "System", role: "SYSTEM" });
const RETURNED = [REQUEST_STATUS.OBSERVED, REQUEST_STATUS.RETURNED, "OBSERVADO_MONTO_EXCEDIDO"];

function wholeNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function followUpConfiguration(env = process.env) {
  return {
    returnedWorkingDays: wholeNumber(env.FOLLOW_UP_RETURNED_WORKING_DAYS, 2),
    draftCloseDays: wholeNumber(env.DRAFT_AUTO_CLOSE_DAYS, 30),
    draftWarningDays: wholeNumber(env.DRAFT_CLOSE_WARNING_DAYS, 5),
    paymentRunNoticeDays: wholeNumber(env.PAYMENT_RUN_NOTICE_WORKING_DAYS, 2)
  };
}

// When the request came back to the requester: the last OBSERVE / RETURN in its history.
export function returnedAt(request) {
  const event = [...(request.approvalHistory || [])].reverse().find((item) => RETURNED.includes(item.to) || ["OBSERVE", "RETURN"].includes(item.action));
  return new Date(event?.createdAt || request.observation?.observedAt || request.updatedAt);
}

export async function remindReturnedRequests({ now = new Date(), config = followUpConfiguration() } = {}) {
  if (!config.returnedWorkingDays) return { scanned: 0, reminders: 0 };
  const requests = await FinancialRequest.find({ status: { $in: RETURNED } }).select("requestNumber requester solicitor status approvalHistory observation updatedAt").lean();
  let reminders = 0;
  for (const request of requests) {
    const since = returnedAt(request);
    const days = workingDaysBetween(since, now);
    const stage = days >= config.returnedWorkingDays * 2 ? "second" : days >= config.returnedWorkingDays ? "first" : null;
    if (!stage) continue;
    await notifyUser({
      once: true,
      userId: request.requester || request.solicitor,
      // One reminder per stage for each time it was sent back.
      eventKey: `request:${request._id}:follow-up:${since.getTime()}:${stage}`,
      type: "REQUEST_FOLLOW_UP",
      title: notificationText("Your request is waiting for your changes"),
      message: notificationText("{requestNumber} was sent back to you {days} working days ago. Make the changes and send it again.", { requestNumber: request.requestNumber, days }),
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
    reminders += 1;
  }
  return { scanned: requests.length, reminders };
}

export async function closeStaleDrafts({ now = new Date(), config = followUpConfiguration() } = {}) {
  const result = { warned: 0, annulled: 0, closedForms: 0, skipped: 0 };
  if (!config.draftCloseDays) return result;
  const closeBefore = new Date(now.getTime() - config.draftCloseDays * DAY_MS);
  const warnBefore = new Date(now.getTime() - Math.max(0, config.draftCloseDays - config.draftWarningDays) * DAY_MS);
  const closeDate = (updatedAt) => limaDateKey(new Date(new Date(updatedAt).getTime() + config.draftCloseDays * DAY_MS)).split("-").reverse().join("/");

  // Saved draft requests.
  const drafts = await FinancialRequest.find({ status: REQUEST_STATUS.DRAFT, updatedAt: { $lt: warnBefore } }).select("+attachments.path");
  for (const request of drafts) {
    const owner = request.requester || request.solicitor;
    if (request.updatedAt >= closeBefore) {
      if (config.draftWarningDays) {
        await notifyUser({ once: true, userId: owner, eventKey: `request:${request._id}:draft-close-warning:${request.updatedAt.getTime()}`, type: "DRAFT_CLOSE_WARNING", title: notificationText("Unfinished request"), message: notificationText("{requestNumber} has not changed in a while. Send it or it will be closed on {date}.", { requestNumber: request.requestNumber, date: closeDate(request.updatedAt) }), path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
        result.warned += 1;
      }
      continue;
    }
    try {
      await transitionRequest({ request, targetStatus: REQUEST_STATUS.VOIDED, user: SYSTEM_ACTOR, action: "DRAFT_AUTO_CLOSED", comments: `Closed automatically after ${config.draftCloseDays} days without changes.`, skipRoleCheck: true, skipControls: true });
      await notifyUser({ once: true, userId: owner, eventKey: `request:${request._id}:draft-auto-closed`, type: "DRAFT_AUTO_CLOSED", title: notificationText("Draft request closed"), message: notificationText("{requestNumber} was closed after {days} days without changes. Use \"Repeat this request\" to start it again.", { requestNumber: request.requestNumber, days: config.draftCloseDays }), path: `/requests/${request._id}`, entityType: "FinancialRequest", entityId: request._id });
      result.annulled += 1;
    } catch (error) {
      // A draft whose month is closed, for example: left as it is for the owner or Admin.
      result.skipped += 1;
      console.warn(`[FOLLOW-UP] Draft ${request.requestNumber} not closed: ${error.message}`);
    }
  }

  // Unsaved form drafts ("Continue your work").
  const forms = await WorkDraft.find({ closed: false, updatedAt: { $lt: warnBefore } }).select("_id owner title route updatedAt");
  for (const form of forms) {
    if (form.updatedAt >= closeBefore) {
      if (config.draftWarningDays) {
        await notifyUser({ once: true, userId: form.owner, eventKey: `work-draft:${form._id}:close-warning:${form.updatedAt.getTime()}`, type: "DRAFT_CLOSE_WARNING", title: notificationText("Unfinished work"), message: notificationText("\"{title}\" has not changed in a while. Finish it or it will be closed on {date}.", { title: form.title, date: closeDate(form.updatedAt) }), path: form.route || "/" });
        result.warned += 1;
      }
      continue;
    }
    await WorkDraft.updateOne({ _id: form._id, closed: false, updatedAt: form.updatedAt }, { $set: { closed: true } }, { timestamps: false });
    result.closedForms += 1;
  }
  return result;
}

const formatMoney = (currency, value) => `${currency === "USD" ? "US$" : "S/"} ${Number(value || 0).toFixed(2)}`;

export async function notifyNextPaymentRun({ now = new Date(), config = followUpConfiguration() } = {}) {
  if (!config.paymentRunNoticeDays) return { notified: false };
  const run = await nextPaymentRunSummary(now);
  if (!run.count || workingDaysBetween(now, new Date(`${run.date}T12:00:00.000Z`)) > config.paymentRunNoticeDays) return { notified: false, ...run };
  const totals = Object.entries(run.totalsByCurrency).map(([currency, item]) => formatMoney(currency, item.total)).join(" + ");
  await notifyRoles({
    once: true,
    roles: [ROLES.TREASURY],
    eventKey: `treasury:payment-run:${run.date}`,
    type: "PAYMENT_RUN_READY",
    title: notificationText("Next payment run"),
    message: notificationText("Payment run of {date}: {count} payments ({total}) are due. Prepare it in one click.", { date: run.date.split("-").reverse().join("/"), count: run.count, total: totals }),
    path: "/treasury?run=next"
  });
  return { notified: true, ...run };
}

export async function runFollowUps({ now = new Date(), env = process.env } = {}) {
  const config = followUpConfiguration(env);
  return {
    returned: await remindReturnedRequests({ now, config }),
    drafts: await closeStaleDrafts({ now, config }),
    paymentRun: await notifyNextPaymentRun({ now, config })
  };
}
