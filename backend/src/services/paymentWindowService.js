import { suggestedPaymentDate } from "../../../shared/businessCalendar.mjs";
import { normalizeRequestPriority } from "../../../shared/requestPriority.mjs";
import { DEFAULT_PAYMENT_CUTOFF_WORKING_DAYS, FINANCE_CONFIGURATION_KEYS, FLOW_TYPE } from "../utils/constants.js";
import { calendarOptions } from "./businessCalendarService.js";
import { getEffectiveFinanceConfiguration } from "./financeConfigurationService.js";

export async function paymentCutoffWorkingDays() {
  const configuration = await getEffectiveFinanceConfiguration(FINANCE_CONFIGURATION_KEYS.PAYMENT_CUTOFF_WORKING_DAYS).catch(() => null);
  const value = Number(configuration?.numericValue);
  return configuration && Number.isFinite(value) && value >= 0 ? value : DEFAULT_PAYMENT_CUTOFF_WORKING_DAYS;
}

// The payment day proposed for a request from its priority and due date ("Pago estimado"), as a
// Lima date key. Advances to render keep their own same-day rule (advancePaymentService).
export async function requestPaymentDateKey(request, now = new Date()) {
  if (!request || request.flowType === FLOW_TYPE.C) return null;
  return suggestedPaymentDate({
    priority: normalizeRequestPriority(request.priority) || "P3",
    dueDate: request.dueDate || null,
    now,
    cutoffWorkingDays: await paymentCutoffWorkingDays(),
    ...calendarOptions()
  });
}

// The same day as a stored date (UTC midnight, like scheduledFor).
export async function requestSuggestedPaymentDate(request, now = new Date()) {
  const key = await requestPaymentDateKey(request, now);
  return key ? new Date(`${key}T00:00:00.000Z`) : undefined;
}
