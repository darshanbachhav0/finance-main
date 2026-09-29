import { Clock3, Loader2, LogOut } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

// Non-blocking notice shown shortly before the session ends. The page stays usable (no backdrop,
// no focus trap); focus moves to "Stay signed in" only when the person is not typing.
export default function SessionExpiryNotice({ minutes, extending = false, onExtend, onLogout }) {
  const { t } = useLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const extendRef = useRef(null);

  useEffect(() => {
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable);
    if (!typing) extendRef.current?.focus({ preventScroll: true });
  }, []);

  const title = t(minutes === 1 ? "Your session expires in 1 minute" : "Your session expires in {minutes} minutes").replace("{minutes}", minutes);
  return createPortal(
    <section className="session-expiry-notice" role="alertdialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <span className="session-expiry-icon" aria-hidden="true"><Clock3 size={20} /></span>
      <div className="session-expiry-body">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{t("Stay signed in to keep working. Your drafts are kept either way.")}</p>
        <div className="session-expiry-actions">
          <button type="button" className="secondary-button" onClick={onLogout} disabled={extending}><LogOut size={16} aria-hidden="true" /><span>{t("Sign out now")}</span></button>
          <button ref={extendRef} type="button" className="primary-button" onClick={onExtend} disabled={extending}>
            {extending && <Loader2 className="spin" size={16} aria-hidden="true" />}<span>{t("Keep me signed in")}</span>
          </button>
        </div>
      </div>
    </section>,
    document.body
  );
}
