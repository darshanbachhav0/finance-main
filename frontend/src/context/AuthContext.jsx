import { flushAllDrafts, clearDraftSessions } from "../utils/workDrafts.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api, { SESSION_EXPIRED_EVENT } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import SessionExpiryNotice from "../components/SessionExpiryNotice.jsx";
import { minutesLeft, sessionExpiresAt, sessionPhase } from "../utils/sessionExpiry.js";
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
  const expiredNoticeShown = useRef(false);
  const warnedFor = useRef(null);

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
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
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

  async function login(dni, password) {
    const response = await api.post("/auth/login", { dni, password });
    clearDraftSessions();
    expiredNoticeShown.current = false;
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

  const value = useMemo(() => ({ user, loading, login, logout, changePassword, extendSession, sessionExpiresAt: expiresAt, isAuthenticated: Boolean(user) }), [user, loading, expiresAt]);

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
