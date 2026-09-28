import { flushAllDrafts, clearDraftSessions } from "../utils/workDrafts.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api, { SESSION_EXPIRED_EVENT } from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { useToast } from "./ToastContext.jsx";

const AuthContext = createContext(null);

function clearStoredSession() {
  localStorage.removeItem("erp_token");
  localStorage.removeItem("erp_user");
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
  const expiredNoticeShown = useRef(false);

  // Any authenticated call answered 401 (see api/client.js): drop the session and return to the
  // sign-in page (ProtectedRoute redirects once user is null). Drafts are deliberately kept - the
  // encrypted draft outbox survives and is offered again after signing back in.
  useEffect(() => {
    const expire = () => {
      if (!localStorage.getItem("erp_token")) return;
      clearStoredSession();
      setUser(null);
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

  async function login(dni, password) {
    const response = await api.post("/auth/login", { dni, password });
    clearDraftSessions();
    expiredNoticeShown.current = false;
    localStorage.setItem("erp_token", response.data.token);
    localStorage.setItem("erp_user", JSON.stringify(response.data.user));
    setUser(response.data.user);
  }

  async function changePassword(currentPassword, newPassword) {
    const response = await api.post("/auth/change-password", { currentPassword, newPassword });
    localStorage.setItem("erp_token", response.data.token);
    localStorage.setItem("erp_user", JSON.stringify(response.data.user));
    setUser(response.data.user);
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

  const value = useMemo(() => ({ user, loading, login, logout, changePassword, isAuthenticated: Boolean(user) }), [user, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
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
