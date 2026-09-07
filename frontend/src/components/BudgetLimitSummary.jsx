import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";

export default function BudgetLimitSummary({ line }) {
  const { t, language } = useLanguage();
  if (!line.planningMode) return null;
  return <div className="budget-limit-summary">
    <span className={line.annualProjected < 0 ? "text-danger" : ""}>{t("Annual available")}: <strong>{formatCurrency(line.annualAvailable, "PEN", language)}</strong></span>
    {line.monthlyAvailable !== null && <span className={line.monthlyProjected < 0 ? "text-danger" : ""}>{t("Monthly available")}: <strong>{formatCurrency(line.monthlyAvailable, "PEN", language)}</strong></span>}
    {line.annualProjected < 0 && <small className="text-danger">{t("Annual budget shortfall")}: {formatCurrency(-line.annualProjected, "PEN", language)}</small>}
    {line.monthlyProjected < 0 && <small className="text-danger">{t("Monthly budget shortfall")}: {formatCurrency(-line.monthlyProjected, "PEN", language)}</small>}
  </div>;
}
