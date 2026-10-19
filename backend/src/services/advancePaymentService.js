import { advancePaymentDate } from "../../../shared/businessCalendar.mjs";
import { calendarOptions } from "./businessCalendarService.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";
import { DEFAULT_ADVANCE_PAYMENT_CUTOFF_HOUR, FINANCE_CONFIGURATION_KEYS, FLOW_TYPE } from "../utils/constants.js";

// An advance to render (Track C, entrega a rendir) is money the employee needs now: it is paid
// the same working day it is approved, not on the 15th / 30th. An approval after the cut-off hour
// (Lima, 15:00 by default) is paid the next working day.
export const ADVANCE_PAYMENT_REASON = "Advance to render: paid the same working day, outside the 15th/30th cycle.";

// The advance payable: created by provisionTrackCAdvance with an ANTICIPO voucher.
export const isAdvancePayable = (payable) => payable?.flowType === FLOW_TYPE.C && payable?.voucher?.voucherType === "ANTICIPO";

export async function advanceCutoffHour(date = new Date()) {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.ADVANCE_PAYMENT_CUTOFF_HOUR, date);
  const hour = configuration ? Number(configuration.numericValue) : DEFAULT_ADVANCE_PAYMENT_CUTOFF_HOUR;
  return Number.isInteger(hour) && hour >= 0 && hour <= 24 ? hour : DEFAULT_ADVANCE_PAYMENT_CUTOFF_HOUR;
}

// The Lima date ("YYYY-MM-DD") an advance approved at `now` is paid.
export async function advancePaymentDateKey(now = new Date()) {
  return advancePaymentDate(now, { cutoffHour: await advanceCutoffHour(now), ...calendarOptions() });
}

// Where the employee deposits unspent advance money (bank, account and CCI), as Finance wrote it.
export async function advanceReturnAccount(date = new Date()) {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.ADVANCE_RETURN_ACCOUNT, date);
  return String(configuration?.textValue || "").trim();
}
