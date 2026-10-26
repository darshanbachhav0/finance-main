// The Super Admin oversees the platform read-only: it opens what an Admin opens but never acts in
// a process, except the CECO budget plans it manages with Admin and Treasury. The backend refuses
// its other writes (middleware/auth.js superAdminReadOnly); the UI hides the actions and, as a
// safety net, api/client.js stops a write before it is sent. Must match SUPER_ADMIN_WRITE_PATHS in
// backend/src/middleware/auth.js.
// The Auditor reads the same workspaces (without the Super Admin console) and writes only its own
// notification settings (AUDITOR_WRITE_PATHS in backend/src/middleware/auth.js).
export const READ_ONLY_ROLES = Object.freeze(["SuperAdmin", "Auditor"]);
export const READ_ONLY_WRITE_PATHS = Object.freeze(["/superadmin/", "/notifications/", "/users/me/notification-preferences", "/work-drafts/", "/budget/plans/", "/budget/plan-changes/", "/auth/"]);
export const AUDITOR_WRITE_PATHS = Object.freeze(["/notifications/", "/users/me/notification-preferences", "/auth/"]);

export function isReadOnlyRole(role) {
  return READ_ONLY_ROLES.includes(role);
}

// Whether a read-only user may send this request (method + path relative to the API base).
export function readOnlyMayCall(method, url, role = "SuperAdmin") {
  if (["get", "head", "options"].includes(String(method || "get").toLowerCase())) return true;
  const path = String(url || "").split("?")[0];
  const allowed = role === "Auditor" ? AUDITOR_WRITE_PATHS : READ_ONLY_WRITE_PATHS;
  return allowed.some((item) => path === item.replace(/\/$/, "") || path.startsWith(item));
}

export const READ_ONLY_MESSAGE = "The Super Admin account is read-only here: it can view but not change the work of the platform.";
export const AUDITOR_READ_ONLY_MESSAGE = "The Auditor account is read-only: it can view but not change the work of the platform.";

export function readOnlyMessage(role) {
  return role === "Auditor" ? AUDITOR_READ_ONLY_MESSAGE : READ_ONLY_MESSAGE;
}
