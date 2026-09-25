import { requestStage, requestStages } from "../utils/requestStage.js";
import { displayedRequestStatus } from "../utils/requestPresentation.js";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function RequestStageIndicator({ request, financialProgress, compact = false }) {
  const { t } = useLanguage();
  const stage = requestStage(displayedRequestStatus(request, financialProgress));
  if (compact) {
    // Rejected, voided and observed requests have no linear stage; the status badge says it all.
    if (stage < 0) return null;
    const current = requestStages[Math.min(stage, requestStages.length - 1)];
    return <span className="stage-dots" role="img" aria-label={`${t("Current stage")}: ${t(current)}`} title={t(current)}>{requestStages.map((label, index) => <i key={label} className={index < stage ? "complete" : index === stage ? "current" : ""} />)}</span>;
  }
  return <ol className="simple-stages" aria-label={t("Current stage")}>{requestStages.map((label, index) => <li key={label} className={index < stage ? "complete" : index === stage ? "current" : ""} aria-current={index === stage ? "step" : undefined}><span aria-hidden="true">{index < stage ? "✓" : index === stage ? "●" : "○"}</span>{t(label)}</li>)}</ol>;
}
