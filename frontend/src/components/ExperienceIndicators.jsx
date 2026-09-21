import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";
import { budgetMeasures, slaCountdown } from "../utils/experience.js";

export function Freshness({ at }) {
  const { t, language } = useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  return <span className={`freshness${minutes >= 5 ? " stale" : ""}`} title={at ? formatDateTime(at, language) : ""}>{t("Last refreshed")}: {Number.isFinite(minutes) ? minutes < 1 ? t("Just now") : `${minutes} ${t("min ago")}` : "—"}</span>;
}

export function SlaCountdown({ request }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const value = slaCountdown(request, now);
  if (!value) return null;
  return <span className={`sla-countdown${value.overdue ? " overdue" : ""}`} title={request.approvalDueAt}>{t(value.overdue ? "Overdue by" : "Due in")} {value.days ? `${value.days}d ` : ""}{value.hours}h {value.minutes}m</span>;
}

export function BudgetBars({ totals = {}, currency = "PEN" }) {
  const { t, language } = useLanguage();
  return <div className="budget-bars"><strong>{t("Assigned")}: {formatCurrency(totals.assigned || 0, currency, language)}</strong>{budgetMeasures(totals).map(item => <div key={item.key} className={`budget-measure ${item.key}`}><span>{t({ committed: "Committed", executed: "Executed", paid: "Paid", available: "Available" }[item.key])}</span><strong>{formatCurrency(item.value, currency, language)}</strong><progress aria-label={t(item.key)} value={item.percent} max="100" /></div>)}<small>{t("Each bar is a share of assigned budget. Paid is not added to executed.")}</small></div>;
}

export function ApprovalJourney({ request }) {
  const { t, language } = useLanguage();
  const route = request.approvalRouteSnapshot || [];
  if (!route.length) return null;
  return <div className="approval-journey"><h3>{t("Approval journey")}</h3><ol>{route.map((step, index) => <li key={`${step.sequence}-${index}`} className={step.status === "APPROVED" ? "complete" : step.approvalLevel === request.approvalStage && ["PENDIENTE_APROBACION", "APROBADO_DIRECTOR"].includes(request.status) ? "current" : ""}><strong>{t(step.approvalLevel || step.role)}</strong><span>{t(step.role)} · {t(step.status || "Pending")}</span>{step.completedAt && <small>{t("Completed")}: {formatDateTime(step.completedAt, language)}</small>}{step.dueAt && <small>{t("SLA due")}: {formatDateTime(step.dueAt, language)}</small>}</li>)}</ol><SlaCountdown request={request} /></div>;
}

export function HealthIndicators({ warnings = [] }) {
  const { t } = useLanguage();
  return <details className="workspace-panel health-indicators"><summary>{t("Attention indicators")} · {warnings.length}</summary>{warnings.length ? warnings.map(warning => <Link key={warning.key} to={warning.path}><strong>{t(warning.label)}</strong><span>{warning.count}</span></Link>) : <p>{t("No alerts reported for the current dashboard scope.")}</p>}<small>{t("Based on the current dashboard alerts, not a financial certification.")}</small></details>;
}
