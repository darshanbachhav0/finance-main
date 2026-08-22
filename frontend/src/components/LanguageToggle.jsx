import { Languages } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function LanguageToggle() {
  const { language, toggleLanguage, t } = useLanguage();

  return (
    <button className={`language-toggle ${language === "es" ? "is-es" : ""}`} type="button" onClick={toggleLanguage} title={t("Language")} aria-label={t("Language")}>
      <Languages size={17} />
      <span>{language === "en" ? t("EN") : t("ES")}</span>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}
