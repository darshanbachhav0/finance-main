import axios from "axios";

function defaultApiUrl() {
  if (import.meta.env.PROD) return "/api";
  const host = window.location.hostname || "localhost";
  return `http://${host}:5000/api`;
}

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
    if (response.config?.method && response.config.method.toLowerCase() !== "get") {
      window.dispatchEvent(new CustomEvent("erp:tasks-changed"));
    }
    return response;
  },
  (error) => {
    const message = error.response?.data?.message || error.message || "Unexpected API error.";
    const details = error.response?.data?.details;
    const code = error.response?.data?.code || "API_ERROR";
    return Promise.reject({ message, code, details, status: error.response?.status });
  }
);

export default api;
