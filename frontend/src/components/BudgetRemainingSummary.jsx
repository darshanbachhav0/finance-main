import { useId } from "react";
import { RefreshCw } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { simulationSources } from "../utils/budgetSimulation.js";

export default function BudgetRemainingSummary({ payload, preview, loading, onRefresh, expenseTypes = [] }) {
  const { t, language } = useLanguage();
  const id = useId();
  const money = value => formatCurrency(value, "PEN", language);
  const sources = simulationSources(preview);
  function balance(label, available, projected) {
    if (available == null || projected == null) return null;
    const percentage = available > 0 ? Math.max(0, Math.min(100, projected / available * 100)) : 0;
    return <div className="remaining-budget-limit">
      <div><span>{t(label)}</span><strong className={projected < 0 ? "text-danger" : ""}>{money(projected)}</strong></div>
      <div className="remaining-budget-bar" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></div>
      <small>{projected < 0 ? `${t("Budget shortfall")}: ${money(-projected)}` : `${t("Available now")}: ${money(available)}`}</small>
    </div>;
  }
  return <section className="remaining-budget" aria-labelledby={id} aria-busy={loading}>
    <header><div><h3 id={id}>{t("Remaining budget")}</h3><p>{t("Balance after this request. No funds are reserved here.")}</p></div><button type="button" className="icon-button" onClick={onRefresh} disabled={loading} aria-label={t("Refresh balances")} title={t("Refresh balances")}><RefreshCw size={16} className={loading ? "spin" : ""} /></button></header>
    <div aria-live="polite">
      {loading ? <p className="remaining-budget-note">{t("Updating balances…")}</p> : preview.errorMessage ? <p role="alert">{t("Budget information could not be refreshed. Check the request fields and try again.")}</p> : !sources.length ? <p className="remaining-budget-note">{t(preview.reason === "EXCHANGE_RATE_MISSING" ? "Add the USD/PEN exchange rate for the request date to see the remaining budget." : "Complete the accounting dimensions to calculate the budget preview.")}</p> : <>
        {sources.map(source => <article className="remaining-budget-source" key={source.key}>
          <div className="remaining-budget-source-label"><strong>{source.costCenterSnapshot?.code}{expenseTypes.find(item => item._id === String(source.expenseType?._id || source.expenseType))?.name ? ` · ${t(expenseTypes.find(item => item._id === String(source.expenseType?._id || source.expenseType)).name)}` : ""}{source.project ? ` · ${source.project}` : ""}</strong><span>{t("This request")}: {money(source.requested)}</span></div>
          <div className="remaining-budget-limits">{source.planningMode ? <>{balance("Annual remaining", source.annualAvailable, source.annualProjected)}{source.monthlyAvailable != null && balance("Monthly remaining", source.monthlyAvailable, source.monthlyProjected)}</> : balance("Remaining", source.available, source.projectedBalance)}</div>
          {source.mode === "TRANSITIONAL" && <p className="remaining-budget-note">{t("Informational budget only. This balance is not an enforced spending limit.")}</p>}
          {source.planningMode === "ANNUAL_ONLY" && <p className="remaining-budget-note">{t("Annual-only plan: no separate monthly limit.")}</p>}
          {source.status === "PENDING_VALIDATION" && <p className="remaining-budget-note">{t("Pending validation")}</p>}
        </article>)}
        {payload.flowType === "C" && <p className="remaining-budget-note">{t("Advances commit their expense budget at rendition. This is a planning estimate, not a commitment on approval.")}</p>}
        {payload.currency === "USD" && <p className="remaining-budget-note">{t("All balances are in PEN, using the recorded exchange rate for the request date.")}</p>}
      </>}
    </div>
  </section>;
}
