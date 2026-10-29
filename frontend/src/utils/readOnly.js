// Auditoría reads the institution's financial work and never changes it. The backend refuses its
// writes (middleware/auth.js readOnlyOversight); the UI hides the actions and, as a safety net,
// api/client.js stops a write before it is sent. Must match AUDITOR_WRITE_PATHS in
// backend/src/middleware/auth.js.
import { hasRole, ROLES } from "./access.js";

export const READ_ONLY_ROLES = Object.freeze([ROLES.AUDITOR]);
export const AUDITOR_WRITE_PATHS = Object.freeze(["/notifications/", "/users/me/notification-preferences", "/auth/"]);

// Accepts a user or a role name.
export function isReadOnlyRole(userOrRole) {
  return hasRole(typeof userOrRole === "string" ? { role: userOrRole } : userOrRole, READ_ONLY_ROLES);
}

// Whether a read-only user may send this request (method + path relative to the API base).
export function readOnlyMayCall(method, url) {
  if (["get", "head", "options"].includes(String(method || "get").toLowerCase())) return true;
  const path = String(url || "").split("?")[0];
  return AUDITOR_WRITE_PATHS.some((item) => path === item.replace(/\/$/, "") || path.startsWith(item));
}

export const AUDITOR_READ_ONLY_MESSAGE = "Auditoría es de solo lectura: puede consultar pero no modificar el trabajo de la plataforma.";

export function readOnlyMessage() {
  return AUDITOR_READ_ONLY_MESSAGE;
}
