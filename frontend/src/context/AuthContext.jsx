import { flushAllDrafts, clearDraftSessions } from "../utils/workDrafts.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api, { MAINTENANCE_EVENT, SESSION_EXPIRED_EVENT } from "../api/client.js";
import { translateMessage } from "./LanguageContext.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import SessionExpiryNotice from "../components/SessionExpiryNotice.jsx";
import { minutesLeft, sessionExpiresAt, sessionPhase } from "../utils/sessionExpiry.js";
import { isReadOnlyRole } from "../utils/readOnly.js";
import { useToast } from "./ToastContext.jsx";

const AuthContext = createContext(null);
// How often the remaining session time is re-checked (timers pause in background tabs, so a
// single long timeout could fire late; a short interval plus focus/visibility checks cannot).
const SESSION_CHECK_MS = 15000;

function clearStoredSession() {
  localStorage.removeItem("erp_token");
  localStorage.removeItem("erp_user");
}

function storedExpiry() {
  return sessionExpiresAt({ token: localStorage.getItem("erp_token") });
}

export function AuthProvider({ children }) {
  const { notify } = useToast();
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("erp_user");
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("erp_token")));
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [expiresAt, setExpiresAt] = useState(storedExpiry);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(false);
  // Proof of a correct password while the authenticator code is asked for (lives 5 minutes).
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const expiredNoticeShown = useRef(false);
  const warnedFor = useRef(null);

  // A preference the signed-in user changed (e.g. email notifications): kept in the session copy.
  const updateUserFields = useCallback((fields) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...fields };
      localStorage.setItem("erp_user", JSON.stringify(next));
      return next;
    });
  }, []);

  const storeSession = useCallback((data) => {
    localStorage.setItem("erp_token", data.token);
    localStorage.setItem("erp_user", JSON.stringify(data.user));
    setExpiresAt(sessionExpiresAt(data));
    setNow(Date.now());
    setUser(data.user);
  }, []);

  // Any authenticated call answered 401 (see api/client.js): drop the session and return to the
  // sign-in page (ProtectedRoute redirects once user is null). Drafts are deliberately kept - the
  // encrypted draft outbox survives and is offered again after signing back in.
  useEffect(() => {
    const expire = () => {
      if (!localStorage.getItem("erp_token")) return;
      clearStoredSession();
      setUser(null);
      setExpiresAt(null);
      setLoading(false);
      if (!expiredNoticeShown.current) {
        expiredNoticeShown.current = true;
        notify("Your session has expired. Sign in again to continue; your drafts were kept.", "warning", { duration: 10000 });
      }
    };
    // Maintenance started while signed in: only administrators keep working, so the session ends
    // with the reason instead of a series of failing screens.
    const maintenance = (event) => {
      if (!localStorage.getItem("erp_token")) return;
      clearStoredSession();
      setUser(null);
      setExpiresAt(null);
      setLoading(false);
      notify([translateMessage("The platform is in maintenance. Try again later.", localStorage.getItem("erp_language") || "es"), event.detail].filter(Boolean).join(" "), "warning", { duration: 12000 });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    window.addEventListener(MAINTENANCE_EVENT, maintenance);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
      window.removeEventListener(MAINTENANCE_EVENT, maintenance);
    };
  }, [notify]);

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) return;
    api
      .get("/auth/me")
      .then((response) => {
        setUser(response.data.user);
        localStorage.setItem("erp_user", JSON.stringify(response.data.user));
      })
      .catch((error) => {
        // Only a 401 means the token is no longer valid. A network error or a server outage keeps
        // the stored session so the user is not signed out by a flaky connection.
        if (error?.status === 401) {
          clearStoredSession();
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Session clock: re-check while signed in, when the tab becomes visible again, and when another
  // tab extends or ends the session (the token in localStorage is shared).
  useEffect(() => {
    if (!user) return undefined;
    const tick = () => setNow(Date.now());
    const onVisible = () => { if (document.visibilityState !== "hidden") tick(); };
    const onStorage = (event) => {
      if (event.key !== "erp_token") return;
      setExpiresAt(storedExpiry());
      tick();
    };
    const timer = window.setInterval(tick, SESSION_CHECK_MS);
    window.addEventListener("focus", tick);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  const phase = user ? sessionPhase(expiresAt, now) : "hidden";

  useEffect(() => {
    if (phase === "warning" && warnedFor.current !== expiresAt) {
      // Save open drafts to the account while the token still works.
      warnedFor.current = expiresAt;
      void flushAllDrafts();
    }
    // The token has run out: end the session the same way a 401 would (drafts are kept).
    if (phase === "expired") window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }, [phase, expiresAt]);

  async function extendSession() {
    setExtending(true);
    try {
      const response = await api.post("/auth/refresh");
      storeSession(response.data);
      notify("Your session was extended.", "success");
    } catch (error) {
      // A 401 already ended the session (api/client.js); anything else can be retried.
      if (error?.status !== 401) notify("The session could not be extended. Try again.", "error");
    } finally {
      setExtending(false);
    }
  }

  // Returns { twoFactorRequired: true } when the account signs in with an authenticator app; the
  // session starts once verifyTwoFactor() gets a valid code.
  async function login(dni, password) {
    const response = await api.post("/auth/login", { dni, password });
    if (response.data.twoFactorRequired) {
      setTwoFactorChallenge(response.data.challengeToken);
      return { twoFactorRequired: true };
    }
    clearDraftSessions();
    expiredNoticeShown.current = false;
    storeSession(response.data);
    return {};
  }

  async function verifyTwoFactor(code) {
    const response = await api.post("/auth/login/two-factor", { challengeToken: twoFactorChallenge, code });
    setTwoFactorChallenge(null);
    clearDraftSessions();
    expiredNoticeShown.current = false;
    storeSession(response.data);
  }

  const cancelTwoFactor = useCallback(() => setTwoFactorChallenge(null), []);

  async function setupTwoFactor() {
    return (await api.post("/auth/two-factor/setup")).data.data;
  }

  // Enrolment signs out every other session and returns a fresh one.
  async function enableTwoFactor(code) {
    const response = await api.post("/auth/two-factor/enable", { code });
    storeSession(response.data);
  }

  async function changePassword(currentPassword, newPassword) {
    const response = await api.post("/auth/change-password", { currentPassword, newPassword });
    storeSession(response.data);
  }

  const finishLogout = useCallback(async () => {
    setSigningOut(true);
    try {
      // Ends the session on the server too (every token issued so far stops working). If the
      // server cannot be reached the local session is still cleared.
      await api.post("/auth/logout").catch(() => {});
    } finally {
      clearDraftSessions();
      clearStoredSession();
      setUser(null);
      setExpiresAt(null);
      setSigningOut(false);
      setConfirmLogout(false);
    }
  }, []);

  async function logout() {
    const saved = await flushAllDrafts();
    if (!saved) {
      setConfirmLogout(true);
      return;
    }
    await finishLogout();
  }

  // Reloads the signed-in user after a change to their own account (e.g. starting leave).
  const refreshUser = useCallback(async () => {
    const response = await api.get("/auth/me");
    setUser(response.data.user);
    localStorage.setItem("erp_user", JSON.stringify(response.data.user));
    return response.data.user;
  }, []);

  const value = useMemo(() => ({
    user, loading, login, logout, changePassword, extendSession, refreshUser, updateUserFields,
    verifyTwoFactor, cancelTwoFactor, setupTwoFactor, enableTwoFactor, twoFactorPending: Boolean(twoFactorChallenge),
    // The Super Admin oversees read-only: pages hide their actions for it (the backend refuses them too).
    readOnly: isReadOnlyRole(user),
    sessionExpiresAt: expiresAt, isAuthenticated: Boolean(user)
  }), [user, loading, expiresAt, refreshUser, updateUserFields, twoFactorChallenge, cancelTwoFactor]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {phase === "warning" && !confirmLogout && (
        <SessionExpiryNotice
          minutes={minutesLeft(expiresAt, now)}
          extending={extending}
          onExtend={() => { void extendSession(); }}
          onLogout={() => { void logout(); }}
        />
      )}
      <ConfirmDialog
        open={confirmLogout}
        tone="danger"
        title="Unsaved changes"
        description="Some changes have not reached your account. Stay signed in to retry. Sign out anyway?"
        confirmLabel="Sign out anyway"
        cancelLabel="Stay signed in"
        loading={signingOut}
        onConfirm={() => { void finishLogout(); }}
        onClose={() => setConfirmLogout(false)}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
