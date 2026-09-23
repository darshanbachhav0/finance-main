import { REQUEST_LIFECYCLE } from "../../../shared/workflowStatus.mjs";
import StatusBadge from "./StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const terminalStatuses = ["RECHAZADO", "ANULADO", "CERRADO"];

export default function WorkflowStatusLegend() {
  const { t } = useLanguage();
  return <details className="workflow-legend">
    <summary>{t("What do these statuses mean?")}</summary>
    <div className="workflow-legend-content">
      <div><strong>{t("Request lifecycle")}</strong><div className="workflow-legend-badges">{REQUEST_LIFECYCLE.map((status) => <StatusBadge key={status} status={status} />)}</div></div>
      <div><strong>{t("Terminal states")}</strong><div className="workflow-legend-badges">{terminalStatuses.map((status) => <StatusBadge key={status} status={status} />)}</div></div>
      <p>{t("Track C rendition is shown separately from payment status.")}</p>
    </div>
  </details>;
}
