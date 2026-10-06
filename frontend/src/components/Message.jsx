import { useEffect, useRef } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

// Inline feedback. An error scrolls into view when it appears, so a failed action is never
// reported only above the fold (or only in a toast).
export default function Message({ type = "info", children }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const text = typeof children === "string" ? children : "";
  useEffect(() => {
    const element = ref.current;
    if (type !== "error" || !element) return;
    const box = element.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [type, text, Boolean(children)]);
  if (!children) return null;
  const Icon = type === "error" ? AlertCircle : type === "success" ? CheckCircle2 : Info;
  return <div ref={ref} className={`message message-${type}`} role={type === "error" ? "alert" : "status"}><Icon size={18} aria-hidden="true" /><div>{typeof children === "string" ? t(children) : children}</div></div>;
}
