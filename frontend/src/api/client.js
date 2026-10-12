import axios from "axios";
import { apiErrorMessage } from "../utils/validationMessages.js";
import { translateMessage } from "../context/LanguageContext.jsx";
import { isReadOnlyRole, readOnlyMayCall, READ_ONLY_MESSAGE } from "../utils/readOnly.js";

function defaultApiUrl() {
  if (import.meta.env.PROD) return "/api";
  const host = window.location.hostname || "localhost";
  return `http://${host}:5000/api`;
}

export const SESSION_EXPIRED_EVENT = "erp:session-expired";
// The platform went into maintenance while signed in (only administrators keep working).
export const MAINTENANCE_EVENT = "erp:maintenance";
const sessionExemptPaths = ["/auth/login", "/auth/change-password", "/auth/logout", "/auth/login/two-factor", "/auth/two-factor/enable"];

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiUrl()
});

function storedRole() {
  try { return JSON.parse(localStorage.getItem("erp_user") || "null")?.role; } catch { return undefined; }
}

const translate = (text) => translateMessage(text, localStorage.getItem("erp_language") || "es");

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("erp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Safety net for the read-only Super Admin: a write a page forgot to hide never leaves the
  // browser (the backend would refuse it anyway).
  if (token && isReadOnlyRole(storedRole()) && !readOnlyMayCall(config.method, config.url)) {
    return Promise.reject(Object.assign(new Error(READ_ONLY_MESSAGE), { readOnlyBlocked: true }));
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Extending the session (POST /auth/refresh) changes no work items, so it does not reload tasks.
    if (response.config?.method && response.config.method.toLowerCase() !== "get" && !response.config.url?.endsWith("/budget-preview") && !response.config.url?.startsWith("/work-drafts") && !["/operations/submission", "/operations/payments", "/operations/xml-preview"].includes(response.config.url) && !response.config.url?.endsWith("/auth/refresh")) {
      window.dispatchEvent(new CustomEvent("erp:tasks-changed"));
    }
    return response;
  },
  (error) => {
    if (error.readOnlyBlocked) return Promise.reject({ message: translate(READ_ONLY_MESSAGE), code: "READ_ONLY_ROLE", status: 403 });
    // A 401 on an authenticated call means the session ended (expired, signed out elsewhere, or
    // the password changed). AuthContext clears it and sends the user to sign in again; saved
    // drafts are kept. Sign-in and password endpoints answer 401 for wrong passwords instead.
    if (error.response?.status === 401 && localStorage.getItem("erp_token") && !sessionExemptPaths.some((path) => error.config?.url?.endsWith(path))) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    if (error.response?.data?.code === "MAINTENANCE_MODE" && localStorage.getItem("erp_token")) {
      window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: error.response.data.details?.message || "" }));
    }
    const message = apiErrorMessage(error, translate);
    const details = error.response?.data?.details;
    const code = error.response?.data?.code || "API_ERROR";
    return Promise.reject({ message, code, details, status: error.response?.status });
  }
);

export default api;
