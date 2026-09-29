import { CheckCircle2 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";

const STATUS_LABELS = { complete: "Complete", incomplete: "Pending", optional: "Optional" };

/** One heading-led block of the request form with its completion badge. */
export default function RequestFormBlock({ id, title, description, status = "incomplete", action, children }) {
  const { t } = useLanguage();
  const headingId = `request-block-${id}`;
  return <section className={`request-form-block is-${status}`} aria-labelledby={headingId} data-block={id}>
    <header className="request-form-block-head">
      <div>
        <h3 id={headingId}>{t(title)}</h3>
        {description && <p>{t(description)}</p>}
      </div>
      <div className="request-form-block-meta">
        <span className={`request-block-status is-${status}`} aria-live="polite">
          {status === "complete" && <CheckCircle2 size={14} aria-hidden="true" />}
          <span className="sr-only">{t(title)}: </span>{t(STATUS_LABELS[status] || status)}
        </span>
        {action}
      </div>
    </header>
    {children}
  </section>;
}
