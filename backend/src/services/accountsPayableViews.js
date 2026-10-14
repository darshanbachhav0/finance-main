import { AP_STATUS } from "../utils/constants.js";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";

// Accounts Payable work views (the tabs of the Accounts Payable page). "open" is everything
// still to be paid except bounced payments, which have their own view because they need a new
// bank instruction; "due" is the open part due within DUE_SOON_DAYS (overdue included).
export const DUE_SOON_DAYS = 7;
export const OPEN_PAYABLE_STATUSES = Object.freeze([AP_STATUS.OPEN, AP_STATUS.SCHEDULED, AP_STATUS.PAYMENT_FILE_CREATED, AP_STATUS.PARTIALLY_PAID]);
export const PAYABLE_VIEWS = Object.freeze(["open", "due", "bounced", "paid", "all"]);

// End of the Lima day DUE_SOON_DAYS from today.
export function dueSoonLimit(now = new Date()) {
  const lastDay = new Date(Date.parse(`${limaDateKey(now)}T00:00:00Z`) + DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);
  return new Date(`${lastDay}T23:59:59.999-05:00`);
}

// Mongo filter for a view; an unknown or empty view adds nothing.
export function payableViewFilter(view, now = new Date()) {
  if (view === "open") return { status: { $in: OPEN_PAYABLE_STATUSES } };
  if (view === "due") return { status: { $in: OPEN_PAYABLE_STATUSES }, dueDate: { $ne: null, $lte: dueSoonLimit(now) } };
  if (view === "bounced") return { status: AP_STATUS.PAYMENT_BOUNCED };
  if (view === "paid") return { status: AP_STATUS.PAID };
  return {};
}

// $group stage counting every view at once, for the tab badges.
export function payableViewCountGroup(now = new Date()) {
  const open = { $in: ["$status", OPEN_PAYABLE_STATUSES] };
  return {
    _id: null,
    open: { $sum: { $cond: [open, 1, 0] } },
    due: { $sum: { $cond: [{ $and: [open, { $gt: ["$dueDate", null] }, { $lte: ["$dueDate", dueSoonLimit(now)] }] }, 1, 0] } },
    bounced: { $sum: { $cond: [{ $eq: ["$status", AP_STATUS.PAYMENT_BOUNCED] }, 1, 0] } },
    paid: { $sum: { $cond: [{ $eq: ["$status", AP_STATUS.PAID] }, 1, 0] } },
    all: { $sum: 1 }
  };
}
