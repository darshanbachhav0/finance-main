// Shared bits of the Super Admin console (pages/superadmin).

// Saving the platform settings tells the app shell to re-read the announcement and maintenance state.
export const PLATFORM_STATUS_CHANGED_EVENT = "erp:platform-status-changed";

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

// Backup run states (backend/src/models/BackupRun.js): label and badge tone.
export const backupStatus = Object.freeze({
  RUNNING: { label: "Backup running", tone: "info" },
  SUCCEEDED: { label: "Backup completed", tone: "success" },
  FAILED: { label: "Backup failed", tone: "danger" }
});

// Security alert kinds (backend/src/services/securityAlertRules.js) and how the console names them.
export const securityAlertLabels = Object.freeze({
  PERIOD_REOPENED: "Accounting period reopened",
  APPROVAL_RULE_CHANGED: "Approval rule changed",
  BANK_FORMAT_CHANGED: "Bank file format changed",
  PERMISSIONS_CHANGED: "Additional permissions changed",
  FINANCE_ROLE_ASSIGNED: "Treasury or Accounting role given"
});

// The record an audit entry is about, in a few words.
export function auditSubject(row) {
  const values = row?.newValues || {};
  return [row?.requestNumber, values.name, values.period, values.role, values.identifier].filter(Boolean).join(" · ") || row?.entityType || "";
}

// Old and new values side by side, for the details panel. Values are shown as JSON text.
export function auditChanges(row) {
  const before = row?.oldValues || {};
  const after = row?.newValues || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((key) => ({ key, before: before[key], after: after[key] }))
    .filter((item) => JSON.stringify(item.before) !== JSON.stringify(item.after) || !Object.keys(before).length);
}

export function displayValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
