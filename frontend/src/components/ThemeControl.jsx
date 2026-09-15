import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return <label className="theme-control"><Icon size={17} aria-hidden="true" /><span>{t("Appearance")}</span><select aria-label={t("Appearance")} value={theme} onChange={event => setTheme(event.target.value)}><option value="system">{t("System")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option></select></label>;
}
