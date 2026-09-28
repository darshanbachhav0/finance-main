import { useLanguage } from "../context/LanguageContext.jsx";

// Shown while a page is narrowed to the record a notification linked to.
export default function DeepLinkNotice({ title, description, missing = false, missingDescription, clearLabel = "Show all records", onClear }) {
  const { t } = useLanguage();
  return (
    <div className={`alert-strip deep-link-notice${missing ? " warning" : ""}`} role="status">
      <div>
        <strong>{t(title)}</strong>
        <p>{t(missing ? missingDescription || "The linked record is no longer pending here. It may already have been processed." : description || "Opened from a notification or task.")}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onClear}>{t(clearLabel)}</button>
    </div>
  );
}
