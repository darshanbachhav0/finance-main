import { CircleAlert } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { PLAIN_STATUSES, PLAIN_STEPS, plainNextStep, plainStatusKey } from "../utils/plainStatus.js";

const fill = (text, params = {}) => Object.entries(params).reduce((result, [key, value]) => result.replace(`{${key}}`, value ?? ""), text);

// A requester's view of a request's status: the plain status, and below it what is needed from
// them (if anything). `steps` adds the four-step progress line (Draft -> Paid).
export default function PlainStatus({ request, steps = false }) {
  const { t } = useLanguage();
  const key = plainStatusKey(request);
  const status = PLAIN_STATUSES[key];
  const next = plainNextStep(request);
  const position = PLAIN_STEPS.indexOf(key === "NEEDS_CHANGES" ? "DRAFT" : key);
  return (
    <div className="plain-status">
      <span className={`badge badge-${status.tone}`}><span className="badge-label">{t(status.label)}</span></span>
      <small className={`plain-next${next.yours ? " is-yours" : ""}`}>{next.yours && <CircleAlert size={13} aria-hidden="true" />}{t("Needed from you")}: {fill(t(next.text), next.params)}</small>
      {steps && position >= 0 && <ol className="plain-steps" aria-label={t("Request progress")}>
        {PLAIN_STEPS.map((step, index) => <li key={step} className={index < position ? "is-done" : index === position ? "is-current" : ""} aria-current={index === position ? "step" : undefined}>{t(PLAIN_STATUSES[step].label)}</li>)}
      </ol>}
    </div>
  );
}
