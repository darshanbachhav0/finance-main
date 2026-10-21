import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { AppError } from "../utils/AppError.js";

const nextDay = (key, days) => { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0,10); };
const validDay = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key)) && !Number.isNaN(Date.parse(`${key}T12:00:00Z`)) && new Date(`${key}T12:00:00Z`).toISOString().slice(0,10) === key;
// Match shared/calendarDateKey: historical UTC-midnight values are calendar dates;
// timestamps with a time are interpreted in Lima. No old dates are rewritten.
const calendarExpression = value => ({ $let: { vars: { date: { $ifNull: [value,null] } }, in: { $cond: [
  { $eq: ["$$date",null] }, "",
  { $dateToString: { date:"$$date", format:"%Y-%m-%d", timezone: { $cond: [{ $eq:[{ $mod:[{ $toLong:"$$date" },86400000] },0] },"UTC","America/Lima"] } } }
] } } });
export function treasuryDateFilter(params, now = new Date()) {
  const today = limaDateKey(now);
  let from, to;
  switch (params.datePreset) {
    case "today": from = to = today; break;
    case "next7": from = today; to = nextDay(today, 6); break;
    case "next15": from = today; to = nextDay(today, 14); break;
    case "month": from = `${today.slice(0,7)}-01`; to = nextDay(`${today.slice(0,7)}-01`, 32).slice(0,7) + "-01"; to = nextDay(to,-1); break;
    case "custom": from = params.dateFrom; to = params.dateTo;
      if (!validDay(from) || !validDay(to) || from > to) throw new AppError(422, "Choose a valid payment date range."); break;
  }
  const clauses = [];
  const payment = calendarExpression({ $ifNull:["$scheduledFor",{ $ifNull:["$plannedPaymentDate","$dueDate"] }] });
  if (from) clauses.push({ $expr:{ $and:[{ $gte:[payment,from] },{ $lte:[payment,to] }] } });
  const due = calendarExpression("$dueDate");
  if (["dueSoon","overdue"].includes(params.paymentStatus)) clauses.push({ $expr:{ $and: params.paymentStatus === "overdue"
    ? [{ $ne:[due,""] },{ $lt:[due,today] }]
    : [{ $gte:[due,today] },{ $lte:[due,nextDay(today,7)] }] } });
  return clauses;
}
