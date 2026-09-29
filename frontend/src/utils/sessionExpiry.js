// Session expiry helpers. The server signs 8-hour JWTs and returns `expiresAt` with every token;
// the token's own `exp` claim is the fallback (sessions stored before `expiresAt` existed).

export const SESSION_WARNING_LEAD_MS = 5 * 60 * 1000;

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  if (typeof atob === "function") return atob(base64);
  return Buffer.from(base64, "base64").toString("binary");
}

// Milliseconds since the epoch at which the token expires, or null when it cannot be read.
// Only the payload is read: the signature is the server's business.
export function tokenExpiresAt(token) {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(decodeBase64Url(payload));
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function sessionExpiresAt({ token, expiresAt } = {}) {
  const explicit = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(explicit) ? explicit : tokenExpiresAt(token);
}

// "hidden" until the warning window, then "warning", then "expired".
export function sessionPhase(expiresAt, now = Date.now(), lead = SESSION_WARNING_LEAD_MS) {
  if (!Number.isFinite(expiresAt)) return "hidden";
  if (now >= expiresAt) return "expired";
  return now >= expiresAt - lead ? "warning" : "hidden";
}

// Whole minutes left, rounded up, so the notice never says "0 minutes" before the end.
export function minutesLeft(expiresAt, now = Date.now()) {
  return Math.max(1, Math.ceil((expiresAt - now) / 60000));
}
