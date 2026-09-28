import { addWorkingDays } from "./businessCalendarService.js";

const HOUR = 3600000;
function setting(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum}.`);
  return value;
}
// Approval SLAs are measured in Peruvian working days (weekends, national holidays
// and UMA_EXTRA_HOLIDAYS excluded). APPROVAL_SLA_WORKING_DAYS is the time an approver
// has for one step (default 1 working day, the former 24h); SLA_ESCALATION_WORKING_DAYS
// is how many further working days an overdue step waits before it escalates to the
// approver's own jefe.
export function approvalSlaWorkingDays() {
  return setting("APPROVAL_SLA_WORKING_DAYS", 1, 1);
}
export function slaConfiguration() {
  const escalationWorkingDays = setting("SLA_ESCALATION_WORKING_DAYS", 1, 1);
  return {
    dueSoonHours: setting("SLA_DUE_SOON_HOURS", 4, 0),
    escalationWorkingDays,
    // Calendar-hour approximation kept for aggregate dashboard counters only.
    escalationHours: escalationWorkingDays * 24,
    approvalWorkingDays: approvalSlaWorkingDays(),
    pollMs: setting("SLA_POLL_MS", 60000, 1000)
  };
}
// Legacy callers may still pass escalationHours; 24h maps to one working day.
function escalationWorkingDaysOf(config) {
  if (config.escalationWorkingDays) return config.escalationWorkingDays;
  return Math.max(1, Math.ceil(Number(config.escalationHours || 24) / 24));
}
export function escalationDueAt(dueAt, config = slaConfiguration()) {
  return addWorkingDays(dueAt, escalationWorkingDaysOf(config));
}
export function classifyApprovalSla(dueAt, now = new Date(), config = slaConfiguration()) {
  const remainingMs = dueAt ? new Date(dueAt).getTime() - now.getTime() : NaN;
  if (!Number.isFinite(remainingMs)) return { severity: "LOW", overdue: false, remainingMs: null, alert: null };
  const escalated = remainingMs < 0 && now.getTime() >= escalationDueAt(dueAt, config).getTime();
  const alert = escalated ? "SLA_ESCALATION"
    : remainingMs < 0 ? "SLA_OVERDUE"
      : remainingMs <= config.dueSoonHours * HOUR ? "SLA_DUE_SOON" : null;
  return { severity: remainingMs < 0 ? "OVERDUE" : alert ? "HIGH" : remainingMs <= 12 * HOUR ? "MEDIUM" : "LOW", overdue: remainingMs < 0, remainingMs, dueAt, alert };
}
