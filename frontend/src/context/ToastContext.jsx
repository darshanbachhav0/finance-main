import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLanguage } from "./LanguageContext.jsx";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, exiting: true } : toast));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 160);
  }, []);

  const notify = useCallback((message, tone = "success", options = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone, action: options.action }]);
    window.setTimeout(() => dismiss(id), options.duration || 5000);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label={t("Notifications")}>
        {toasts.map((toast) => {
          const Icon = toast.tone === "error" ? AlertCircle : toast.tone === "warning" ? AlertTriangle : toast.tone === "info" ? Info : CheckCircle2;
          return (
            <div className={`toast toast-${toast.tone}${toast.exiting ? " is-exiting" : ""}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
              <Icon size={19} aria-hidden="true" />
              <div className="toast-content">
                <span>{t(toast.message)}</span>
                {toast.action && (
                  <button type="button" className="toast-action" onClick={() => { toast.action.onClick(); dismiss(toast.id); }}>
                    {t(toast.action.label)}
                  </button>
                )}
              </div>
              <button type="button" className="icon-button quiet" onClick={() => dismiss(toast.id)} aria-label={t("Dismiss notification")}>
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
