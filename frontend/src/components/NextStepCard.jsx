import { ArrowRight, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import RenditionReviewPanel from "./rendition/RenditionReviewPanel.jsx";

// "Your turn" on a request (utils/nextStep.js): what the viewer has to do now and the button that
// does it. A step that is not the viewer's is a one-line note.
export default function NextStepCard({ step, request, processing = false, onRun, onOpen, onReload }) {
  const { t, language } = useLanguage();
  if (!step) return null;
  const params = { ...(step.params || {}) };
  if (typeof params.amount === "number") params.amount = formatCurrency(params.amount, request.currency || "PEN", language);
  const fill = (text) => Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value ?? ""), t(text));

  if (!step.mine) {
    return <div className="record-next-action"><div><strong>{t("Next step")}</strong><p>{fill(step.text)}</p></div></div>;
  }

  const button = (action, primary) => {
    if (!action) return null;
    const className = primary ? "primary-button" : "secondary-button";
    const content = <><span>{t(action.label)}</span>{primary && <ArrowRight size={16} aria-hidden="true" />}</>;
    if (action.href) return <Link className={className} to={action.href}>{content}</Link>;
    if (action.run) return <button type="button" className={className} disabled={processing} onClick={() => onRun?.(action.run)}>{content}</button>;
    return <button type="button" className={className} onClick={() => onOpen?.(action.open)}>{content}</button>;
  };

  return (
    <section id="next-step" className={`next-step-card tone-${step.tone || "turn"}`} aria-labelledby="next-step-title">
      <div className="next-step-head">
        <span className="next-step-icon" aria-hidden="true"><ListChecks size={20} /></span>
        <div>
          <p className="next-step-eyebrow">{t("Your turn")}</p>
          <h2 id="next-step-title">{fill(step.title)}</h2>
          <p>{fill(step.text)}</p>
        </div>
      </div>
      {step.review && <RenditionReviewPanel request={request} onReload={onReload} />}
      {(step.action || step.more) && (
        <div className="next-step-actions">
          {button(step.action, true)}
          {button(step.more, false)}
        </div>
      )}
    </section>
  );
}
