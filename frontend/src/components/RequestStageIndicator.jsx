import { requestStage, requestStages } from "../utils/requestStage.js";
import { displayedRequestStatus } from "../utils/requestPresentation.js";
import { useLanguage } from "../context/LanguageContext.jsx";
export default function RequestStageIndicator({ request, financialProgress }) {
  const { t } = useLanguage();
  const stage = requestStage(displayedRequestStatus(request, financialProgress));
  return <ol className="simple-stages" aria-label={t("Current stage")}>{requestStages.map((label, index) => <li key={label} className={index < stage ? "complete" : index === stage ? "current" : ""} aria-current={index === stage ? "step" : undefined}><span aria-hidden="true">{index < stage ? "✓" : index === stage ? "●" : "○"}</span>{t(label)}</li>)}</ol>;
}
