// The Super Admin oversees the platform read-only: it opens what an Admin opens but never acts in
// a process. The backend refuses its writes (middleware/auth.js superAdminReadOnly); the UI hides
// the actions and, as a safety net, api/client.js stops a write before it is sent. Must match
// SUPER_ADMIN_WRITE_PATHS in backend/src/middleware/auth.js.
export const READ_ONLY_ROLES = Object.freeze(["SuperAdmin"]);
export const READ_ONLY_WRITE_PATHS = Object.freeze(["/superadmin/", "/notifications/", "/users/me/notification-preferences", "/work-drafts/", "/auth/"]);

export function isReadOnlyRole(role) {
  return READ_ONLY_ROLES.includes(role);
}

// Whether a read-only user may send this request (method + path relative to the API base).
export function readOnlyMayCall(method, url) {
  if (["get", "head", "options"].includes(String(method || "get").toLowerCase())) return true;
  const path = String(url || "").split("?")[0];
  return READ_ONLY_WRITE_PATHS.some((allowed) => path === allowed.replace(/\/$/, "") || path.startsWith(allowed));
}

export const READ_ONLY_MESSAGE = "The Super Admin account is read-only here: it can view but not change the work of the platform.";
