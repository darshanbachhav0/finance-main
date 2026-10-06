import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "./LanguageContext.jsx";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const clearTimer = useCallback((id) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback((id) => {
    clearTimer(id);
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, exiting: true } : toast));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 160);
  }, [clearTimer]);

  const startTimer = useCallback((toast) => {
    if (!toast.duration) return;
    clearTimer(toast.id);
    timers.current.set(toast.id, window.setTimeout(() => dismiss(toast.id), toast.duration));
  }, [clearTimer, dismiss]);

  // Errors stay until the person dismisses them (unless the caller sets a duration), so a failure
  // is never gone before it is read. Other toasts close after 5s; hovering or focusing one pauses it.
  const notify = useCallback((message, tone = "success", options = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    const duration = options.duration ?? (tone === "error" ? 0 : 5000);
    const toast = { id, message, tone, action: options.action, duration };
    setToasts((current) => [...current.filter((item) => item.exiting || item.tone !== "error" || tone !== "error" || item.message !== message), toast]);
    startTimer(toast);
    return id;
  }, [startTimer]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  useEffect(() => { const warn = () => notify("The record was saved, but its old draft could not be removed. Discard it from Continue your work; do not submit it again.", "warning", { duration: 12000 }); window.addEventListener("uma:draft-cleanup-warning", warn); return () => window.removeEventListener("uma:draft-cleanup-warning", warn); }, [notify]);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label={t("Notifications")}>
        {toasts.map((toast) => {
          const Icon = toast.tone === "error" ? AlertCircle : toast.tone === "warning" ? AlertTriangle : toast.tone === "info" ? Info : CheckCircle2;
          return (
            <div className={`toast toast-${toast.tone}${toast.exiting ? " is-exiting" : ""}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"} onMouseEnter={() => clearTimer(toast.id)} onMouseLeave={() => startTimer(toast)} onFocus={() => clearTimer(toast.id)} onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && startTimer(toast)}>
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
