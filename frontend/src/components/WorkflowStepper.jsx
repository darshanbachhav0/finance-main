import { Check } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function WorkflowStepper({ steps, current, completedSteps = [], maxAccessible = current, onSelect }) {
  const { t } = useLanguage();
  return (
    <ol className="workflow-stepper" aria-label={t("Request progress")}>
      {steps.map((step, index) => {
        const completed = completedSteps.includes(index) || index < current;
        const active = index === current;
        return (
          <li key={step} className={`${completed ? "completed" : ""} ${active ? "active" : ""}`}>
            <button type="button" onClick={() => onSelect?.(index)} disabled={!onSelect || index > maxAccessible} aria-current={active ? "step" : undefined}>
              <span className="step-number">{completed ? <Check size={15} /> : index + 1}</span>
              <span>{t(step)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
