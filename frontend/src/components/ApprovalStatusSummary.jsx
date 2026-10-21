import { useLanguage } from "../context/LanguageContext.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { formatDateTime } from "../utils/formatters.js";
import "../styles/approvalOptimization.css";

export default function ApprovalStatusSummary({ request, holder, onHistory }) {
  const { t, language } = useLanguage();
  const pending = [...(request.approvalRouteSnapshot || [])].sort((a,b) => a.sequence-b.sequence).find(step => step.required !== false && step.status === "PENDING");
  const latest = [...(request.approvalHistory || [])].reverse().find(event => /(^APPROVE$|_APPROVED$|^CHAIN_APPROVED_(FINAL|FORWARDED)$|^APPROVED$|SIGN_OFF)/.test(event.action || "") && event.actor?.name);
  const stage = pending ? t(pending.approvalLevel) : holder?.name ? t(holder.name) : t(request.status);
  return <section className="approval-status-summary" aria-label={t("Approval tracking")}>
    <div><span>{t("Current stage")}</span><strong>{stage}{pending?.approverSnapshot?.name ? ` · ${pending.approverSnapshot.name}` : ""}</strong></div>
    <StatusBadge status={request.status} />
    {latest && <div><span>{t("Latest approval")}</span><strong>{latest.actor.name} · {formatDateTime(latest.createdAt, language)}</strong></div>}
    <button type="button" className="text-button" onClick={onHistory}>{t("View history")}</button>
  </section>;
}
