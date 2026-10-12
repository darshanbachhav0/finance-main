import { ADMINISTRATOR_ROLES } from "../utils/constants.js";

// Audit events the Super Admin is alerted about. Each rule is both a query over AuditLog (the
// Alerts page) and a test of a freshly recorded audit (the bell alert, see auditService).
// Dependency-free on purpose: auditService imports it on every audit.
const MASTER_DATA_CHANGES = ["CREATED", "UPDATED", "DEACTIVATED"];

export const SECURITY_ALERT_RULES = Object.freeze([
  {
    kind: "PERIOD_REOPENED",
    query: { entityType: "AccountingPeriod", action: "REOPENED" }
  },
  {
    kind: "APPROVAL_RULE_CHANGED",
    query: { entityType: "ApprovalRule", module: "MASTER_DATA", action: { $in: MASTER_DATA_CHANGES } }
  },
  {
    kind: "BANK_FORMAT_CHANGED",
    query: { entityType: "BankFormatConfiguration", action: { $in: [...MASTER_DATA_CHANGES, "BBVA_FORMAT_CERTIFIED", "BBVA_FORMAT_DECERTIFIED"] } }
  },
  {
    kind: "PERMISSIONS_CHANGED",
    query: { entityType: "User", action: "PERMISSIONS_CHANGED" }
  },
  {
    kind: "FINANCE_ROLE_ASSIGNED",
    query: { entityType: "User", action: "FINANCE_ROLE_ASSIGNED" }
  },
  {
    kind: "ADMIN_ACCOUNT_LOCKED",
    query: { module: "AUTH", action: "ACCOUNT_LOCKED", role: { $in: ADMINISTRATOR_ROLES } }
  }
]);

export const SECURITY_ALERT_KINDS = Object.freeze(SECURITY_ALERT_RULES.map((rule) => rule.kind));

function matchesValue(value, condition) {
  if (condition && typeof condition === "object" && Array.isArray(condition.$in)) return condition.$in.includes(value);
  return value === condition;
}

// The alert kind of an audit payload, or null.
export function securityAlertKind(audit) {
  if (!audit) return null;
  const rule = SECURITY_ALERT_RULES.find(({ query }) => Object.entries(query).every(([field, condition]) => matchesValue(audit[field], condition)));
  return rule?.kind || null;
}

export function securityAlertQuery(kinds = SECURITY_ALERT_KINDS) {
  const rules = SECURITY_ALERT_RULES.filter((rule) => kinds.includes(rule.kind));
  return rules.length ? { $or: rules.map((rule) => rule.query) } : { _id: null };
}
