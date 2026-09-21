import { useLanguage } from "../context/LanguageContext.jsx";
import { useNavigate } from "react-router-dom";
import { formatCurrency } from "../utils/formatters.js";

export default function BudgetHeatmap({ rows = [] }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  return <details className="workspace-panel budget-heatmap"><summary>{t("Budget availability by cost center")}</summary><p>{t("Select a cost center to review its requests. Values follow the current report filters.")}</p><div className="heatmap-grid">{rows.map((row, index) => {
    const assigned = Number(row.assigned ?? row.amount ?? row.assignedAmount ?? 0);
    const available = row.availableAmount === null || row.available === null ? null : Number(row.available ?? row.availableAmount ?? 0);
    const ratio = assigned > 0 && available !== null ? available / assigned : null;
    const center = row.costCenter;
    const id = typeof center === "string" ? center : center?._id;
    return <button type="button" key={row._id || index} disabled={!id} className={`heatmap-cell ${ratio === null ? "" : ratio <= 0.1 ? "low" : ratio <= 0.3 ? "watch" : "healthy"}`} onClick={() => navigate(`/requests?costCenter=${encodeURIComponent(id)}${row.period ? `&period=${encodeURIComponent(row.period)}` : ""}`)}><strong>{center?.code || row.costCenterCode || t("Unassigned")}</strong><span>{center?.name || row.area || ""}</span><span>{row.period || ""}</span><b>{available === null ? t("Annual plan only") : formatCurrency(available, "PEN", language)}</b><small>{t("Available")} · {ratio === null ? "—" : `${Math.round(ratio * 100)}%`}</small></button>;
  })}</div>{!rows.length && <p>{t("No budget allocations in this scope.")}</p>}</details>;
}
