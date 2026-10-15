import FinancialRequest from "../models/FinancialRequest.js";
import { REQUEST_TYPE } from "../utils/constants.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { workingDaysBetween } from "./businessCalendarService.js";
import { notificationText, notifyUser } from "./notificationService.js";

// Reminds the employee of an advance whose rendition is still due: when 3 working days or fewer
// remain, when 1 working day or less remains, and once when the deadline has passed. Each
// reminder has its own event key and is sent once, so the scan can run as often as the SLA worker
// does and a missed scan day still sends the reminder on the next one.
export function renditionReminderStage(dueAt, now = new Date()) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  if (now > due) return { stage: "overdue", daysLeft: 0 };
  const daysLeft = workingDaysBetween(now, due);
  if (daysLeft <= 1) return { stage: "1", daysLeft };
  if (daysLeft <= 3) return { stage: "3", daysLeft };
  return null;
}

export async function remindRenditionDeadlines({ now = new Date() } = {}) {
  const requests = await FinancialRequest.find({
    requestType: REQUEST_TYPE.ENTREGA_RENDIR,
    "rendition.status": { $in: ["PENDING", "OBSERVED"] },
    "rendition.dueAt": { $ne: null }
  }).select("requestNumber requester solicitor rendition.dueAt rendition.status").lean();

  let reminders = 0;
  for (const request of requests) {
    const userId = request.requester || request.solicitor;
    const reminder = renditionReminderStage(request.rendition.dueAt, now);
    if (!userId || !reminder) continue;
    const params = { requestNumber: request.requestNumber, date: limaDateKey(request.rendition.dueAt).split("-").reverse().join("/"), days: reminder.daysLeft };
    const overdue = reminder.stage === "overdue";
    await notifyUser({
      once: true,
      userId,
      eventKey: `request:${request._id}:rendition-reminder:${reminder.stage}`,
      type: overdue ? "RENDITION_OVERDUE" : "RENDITION_REMINDER",
      title: overdue ? notificationText("Rendition deadline passed") : notificationText("Rendition due soon"),
      message: overdue
        ? notificationText("{requestNumber}: the rendition deadline ({date}) has passed. Submit it as soon as possible.", params)
        : reminder.daysLeft === 1
          ? notificationText("{requestNumber}: 1 working day left to submit your rendition (deadline {date}).", params)
          : reminder.daysLeft === 0
            ? notificationText("{requestNumber}: your rendition is due today ({date}).", params)
            : notificationText("{requestNumber}: {days} working days left to submit your rendition (deadline {date}).", params),
      path: `/requests/${request._id}`,
      entityType: "FinancialRequest",
      entityId: request._id
    });
    reminders += 1;
  }
  return { scanned: requests.length, reminders };
}
