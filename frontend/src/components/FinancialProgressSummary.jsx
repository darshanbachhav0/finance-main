import StatusBadge from "./StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { displayedRequestStatus } from "../utils/requestPresentation.js";

export default function FinancialProgressSummary({ request, financialProgress, renditionRequirements, compact = false }) {
  const { t } = useLanguage();
  const progress = financialProgress || request?.financialProgress || {};
  const counts = progress.counts || {};
  const total = Number(counts.total || 0);
  const status = displayedRequestStatus(request, progress);
  const isTrackC = request?.flowType === "C" || request?.requestType === "ENTREGA_RENDIR";
  const paymentStatus = progress.status || (["PAGADO", "CONCILIADO", "CERRADO"].includes(status) ? status : "PENDING");

  return <div className={`financial-progress-summary${compact ? " compact" : ""}`}>
    <div className="financial-progress-status">{!compact && <span>{t("Request status")}</span>}<StatusBadge status={status} /></div>
    {(total > 1 || progress.partialPayment || progress.partialReconciliation) && <div className="financial-progress-counts" aria-live="polite">
      <span><strong>{counts.paid || 0}/{total}</strong> {t("Paid invoices")}</span>
      <span><strong>{counts.reconciled || 0}/{total}</strong> {t("Reconciled invoices")}</span>
      {progress.partialPayment && <StatusBadge status="PARTIALLY_PAID" />}
    </div>}
    {isTrackC && <div className="financial-progress-rendition">
      <span>{t("Payment status")}</span>
      <StatusBadge status={paymentStatus} />
      <span>{t("Rendition status")}</span>
      <StatusBadge status={progress.renditionStatus || request?.rendition?.status || "PENDING"} />
      {renditionRequirements?.missing?.length > 0 && <small>{t("Pending rendition requirements")}: {renditionRequirements.missing.map((item) => t(typeof item === "string" ? item : item.label || item.labelKey || item.kind)).join(", ")}</small>}
    </div>}
  </div>;
}
