import { CircleAlert } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { PLAIN_STATUSES, plainNextStep, plainStatusKey } from "../utils/plainStatus.js";

const fill = (text, params = {}) => Object.entries(params).reduce((result, [key, value]) => result.replace(`{${key}}`, value ?? ""), text);

// A requester's view of a request's status: the plain status, and below it what is needed from
// them (if anything).
export default function PlainStatus({ request }) {
  const { t } = useLanguage();
  const key = plainStatusKey(request);
  const status = PLAIN_STATUSES[key];
  const next = plainNextStep(request);
  return (
    <div className="plain-status">
      <span className={`badge badge-${status.tone}`}><span className="badge-label">{t(status.label)}</span></span>
      <small className={`plain-next${next.yours ? " is-yours" : ""}`}>{next.yours && <CircleAlert size={13} aria-hidden="true" />}{t("Needed from you")}: {fill(t(next.text), next.params)}</small>
    </div>
  );
}
