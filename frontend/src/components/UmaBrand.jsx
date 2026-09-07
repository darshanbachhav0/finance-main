import { useLanguage } from "../context/LanguageContext.jsx";

export default function UmaBrand({ className = "", compact = false }) {
  const { t } = useLanguage();
  return <div className={`uma-brand ${compact ? "uma-brand-compact" : ""} ${className}`.trim()}>
    <img className="uma-logo-full" src="/uma-logo.jpg" alt="UMA — Universidad María Auxiliadora" width="814" height="378" />
    <img className="uma-logo-symbol" src="/uma-icon.svg" alt="UMA" width="48" height="48" />
    <span className="uma-product-name">{t("Financial management")}</span>
  </div>;
}
