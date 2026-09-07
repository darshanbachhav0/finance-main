import { useLanguage } from "../context/LanguageContext.jsx";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

export default function Message({ type = "info", children }) {
  const { t } = useLanguage();
  if (!children) return null;
  const Icon = type === "error" ? AlertCircle : type === "success" ? CheckCircle2 : Info;
  return <div className={`message message-${type}`} role={type === "error" ? "alert" : "status"}><Icon size={18} aria-hidden="true" /><div>{typeof children === "string" ? t(children) : children}</div></div>;
}
