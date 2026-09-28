import axios from "axios";
import { apiErrorMessage } from "../utils/validationMessages.js";
import { translateMessage } from "../context/LanguageContext.jsx";

function defaultApiUrl() {
  if (import.meta.env.PROD) return "/api";
  const host = window.location.hostname || "localhost";
  return `http://${host}:5000/api`;
}

export const SESSION_EXPIRED_EVENT = "erp:session-expired";
const sessionExemptPaths = ["/auth/login", "/auth/change-password", "/auth/logout"];

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiUrl()
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("erp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.config?.method && response.config.method.toLowerCase() !== "get" && !response.config.url?.endsWith("/budget-preview") && !response.config.url?.startsWith("/work-drafts")) {
      window.dispatchEvent(new CustomEvent("erp:tasks-changed"));
    }
    return response;
  },
  (error) => {
    // A 401 on an authenticated call means the session ended (expired, signed out elsewhere, or
    // the password changed). AuthContext clears it and sends the user to sign in again; saved
    // drafts are kept. Sign-in and password endpoints answer 401 for wrong passwords instead.
    if (error.response?.status === 401 && localStorage.getItem("erp_token") && !sessionExemptPaths.some((path) => error.config?.url?.endsWith(path))) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    const message = apiErrorMessage(error, text => translateMessage(text, localStorage.getItem("erp_language") || "es"));
    const details = error.response?.data?.details;
    const code = error.response?.data?.code || "API_ERROR";
    return Promise.reject({ message, code, details, status: error.response?.status });
  }
);

export default api;
