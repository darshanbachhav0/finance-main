const HOUR = 3600000;
function setting(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum}.`);
  return value;
}
export function slaConfiguration() {
  return {
    dueSoonHours: setting("SLA_DUE_SOON_HOURS", 4, 0),
    escalationHours: setting("SLA_ESCALATION_HOURS", 24, 0.01),
    pollMs: setting("SLA_POLL_MS", 60000, 1000)
  };
}
export function classifyApprovalSla(dueAt, now = new Date(), config = slaConfiguration()) {
  const remainingMs = dueAt ? new Date(dueAt).getTime() - now.getTime() : NaN;
  if (!Number.isFinite(remainingMs)) return { severity: "LOW", overdue: false, remainingMs: null, alert: null };
  const alert = remainingMs <= -config.escalationHours * HOUR ? "SLA_ESCALATION"
    : remainingMs < 0 ? "SLA_OVERDUE"
      : remainingMs <= config.dueSoonHours * HOUR ? "SLA_DUE_SOON" : null;
  return { severity: remainingMs < 0 ? "OVERDUE" : alert ? "HIGH" : remainingMs <= 12 * HOUR ? "MEDIUM" : "LOW", overdue: remainingMs < 0, remainingMs, dueAt, alert };
}
