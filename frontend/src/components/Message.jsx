import { useLanguage } from "../context/LanguageContext.jsx";

export default function Message({ type = "info", children }) {
  const { t } = useLanguage();
  if (!children) return null;
  return <div className={`message message-${type}`}>{typeof children === "string" ? t(children) : children}</div>;
}
