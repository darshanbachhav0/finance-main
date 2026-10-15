import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatNumber } from "../utils/formatters.js";

const RADIUS = 70;
const ARC = Math.PI * RADIUS;

// How much of the period's budget is already used (committed or executed), as a half-circle
// that fills when it appears. Green below 70%, amber below 90%, red from there.
export default function BudgetGauge({ totals }) {
  const { t, language } = useLanguage();
  const assigned = Number(totals?.assigned || 0);
  if (!(assigned > 0)) return null;
  const available = Number(totals?.available ?? assigned - Number(totals?.committed || 0) - Number(totals?.executed || 0));
  const used = Math.max(0, assigned - available);
  const percent = Math.max(0, Math.min(100, (used / assigned) * 100));
  const tone = percent >= 90 ? "danger" : percent >= 70 ? "warning" : "success";

  return (
    <section className={`workspace-panel budget-gauge tone-${tone}`} aria-labelledby="budget-gauge-title">
      <div className="section-heading compact"><div><h3 id="budget-gauge-title">{t("Budget health")}</h3><p>{t("Share of this period's budget already committed or spent.")}</p></div></div>
      <div className="budget-gauge-body">
        <svg viewBox="0 0 180 100" role="img" aria-label={t("{percent}% of the budget used").replace("{percent}", formatNumber(Math.round(percent), language))}>
          <path className="gauge-track" d="M20 90 A70 70 0 0 1 160 90" />
          <path className="gauge-fill" d="M20 90 A70 70 0 0 1 160 90" style={{ strokeDasharray: ARC, "--gauge-offset": ARC * (1 - percent / 100) }} />
        </svg>
        <div className="budget-gauge-value"><strong>{formatNumber(Math.round(percent), language)}%</strong><span>{t("used")}</span></div>
      </div>
      <dl className="budget-gauge-legend">
        <div><dt>{t("Available")}</dt><dd>{formatCurrency(available, "PEN", language)}</dd></div>
        <div><dt>{t("Assigned")}</dt><dd>{formatCurrency(assigned, "PEN", language)}</dd></div>
      </dl>
    </section>
  );
}
