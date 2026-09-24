import { flushAllDrafts, clearDraftSessions } from "../utils/workDrafts.js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("erp_user");
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("erp_token")));

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) return;
    api
      .get("/auth/me")
      .then((response) => {
        setUser(response.data.user);
        localStorage.setItem("erp_user", JSON.stringify(response.data.user));
      })
      .catch(() => {
        localStorage.removeItem("erp_token");
        localStorage.removeItem("erp_user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(dni, password) {
    const response = await api.post("/auth/login", { dni, password });
    clearDraftSessions();
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

  async function logout() {
    const saved = await flushAllDrafts();
    if (!saved && !window.confirm("Some changes have not reached your account. Stay signed in to retry. Sign out anyway?")) return;
    clearDraftSessions();
    localStorage.removeItem("erp_token");
    localStorage.removeItem("erp_user");
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, login, logout, changePassword, isAuthenticated: Boolean(user) }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
