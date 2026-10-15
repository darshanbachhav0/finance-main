import AccountsPayable from "../models/AccountsPayable.js";
import FinancialRequest from "../models/FinancialRequest.js";
import { AP_STATUS, FLOW_TYPE, REQUEST_STATUS } from "../utils/constants.js";
import { limaToday, nextPaymentCycleDate } from "../../../shared/businessCalendar.mjs";

// The signed-in person's own numbers for the dashboard greeting: their requests this year, what
// is still moving, what has been paid, the next payment they can expect, and - for anyone who
// decides approvals - how many decisions they made this month and how long they took.

// Lima is UTC-5 all year, so a Lima calendar day starts at 05:00 UTC.
const limaMidnight = (dateKey) => new Date(`${dateKey}T05:00:00.000Z`);
const FINISHED = [REQUEST_STATUS.DRAFT, REQUEST_STATUS.CLOSED, REQUEST_STATUS.REJECTED, REQUEST_STATUS.VOIDED, "PAGADO_CERRADO"];
const UNPAID = [AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID, AP_STATUS.PAYMENT_BOUNCED];
const DECIDED = ["APPROVED", "REJECTED", "OBSERVED", "RETURNED"];
const round = (value) => Math.round(Number(value || 0) * 100) / 100;

// A scheduled payable pays on its scheduled day; an unscheduled one is expected on the next
// payment cycle (15th / 30th), which is an estimate until Treasury schedules it.
export function expectedPaymentDate(payable, now = new Date()) {
  if (payable?.scheduledFor) return { date: new Date(payable.scheduledFor).toISOString().slice(0, 10), estimated: false };
  return { date: nextPaymentCycleDate(now), estimated: true };
}

export async function personalDashboard(user, { now = new Date() } = {}) {
  const today = limaToday(now);
  const yearStart = limaMidnight(`${today.slice(0, 4)}-01-01`);
  const monthStart = limaMidnight(`${today.slice(0, 7)}-01`);
  const mine = { $or: [{ requester: user._id }, { solicitor: user._id }] };

  const [requests, decisions] = await Promise.all([
    FinancialRequest.find(mine).select("_id requestNumber status flowType currency createdAt").lean(),
    FinancialRequest.aggregate([
      { $match: { "approvalRouteSnapshot.completedBy": user._id } },
      { $unwind: "$approvalRouteSnapshot" },
      { $match: { "approvalRouteSnapshot.completedBy": user._id, "approvalRouteSnapshot.status": { $in: DECIDED }, "approvalRouteSnapshot.completedAt": { $gte: monthStart } } },
      { $project: { minutes: { $cond: [{ $and: ["$approvalRouteSnapshot.startedAt", "$approvalRouteSnapshot.completedAt"] }, { $divide: [{ $subtract: ["$approvalRouteSnapshot.completedAt", "$approvalRouteSnapshot.startedAt"] }, 60000] }, null] } } },
      { $group: { _id: null, count: { $sum: 1 }, averageMinutes: { $avg: "$minutes" } } }
    ])
  ]);

  const byId = new Map(requests.map((request) => [String(request._id), request]));
  const payables = requests.length
    ? await AccountsPayable.find({ request: { $in: [...byId.keys()] }, status: { $ne: AP_STATUS.CANCELLED } }).select("request status outstandingAmount originalAmount penEquivalent currency scheduledFor updatedAt").lean()
    : [];

  const paidThisYear = payables.filter((payable) => payable.status === AP_STATUS.PAID && new Date(payable.updatedAt) >= yearStart);
  const paidToMe = paidThisYear.filter((payable) => byId.get(String(payable.request))?.flowType === FLOW_TYPE.C);
  const upcoming = payables
    .filter((payable) => UNPAID.includes(payable.status) && Number(payable.outstandingAmount) > 0)
    .map((payable) => {
      const request = byId.get(String(payable.request));
      return { requestId: payable.request, requestNumber: request?.requestNumber, amount: round(payable.outstandingAmount), currency: payable.currency, ...expectedPaymentDate(payable, now) };
    })
    .sort((left, right) => left.date.localeCompare(right.date));

  const decided = decisions[0];
  return {
    requests: {
      submittedThisYear: requests.filter((request) => request.status !== REQUEST_STATUS.DRAFT && new Date(request.createdAt) >= yearStart).length,
      inProgress: requests.filter((request) => !FINISHED.includes(request.status)).length,
      drafts: requests.filter((request) => request.status === REQUEST_STATUS.DRAFT).length
    },
    payments: {
      paidThisYearPen: round(paidThisYear.reduce((sum, payable) => sum + Number(payable.penEquivalent || 0), 0)),
      paidToMeThisYearPen: round(paidToMe.reduce((sum, payable) => sum + Number(payable.penEquivalent || 0), 0)),
      next: upcoming[0] || null,
      upcomingCount: upcoming.length
    },
    approvals: decided ? { decidedThisMonth: decided.count, averageHours: decided.averageMinutes === null ? null : Math.round(decided.averageMinutes / 6) / 10 } : { decidedThisMonth: 0, averageHours: null }
  };
}
