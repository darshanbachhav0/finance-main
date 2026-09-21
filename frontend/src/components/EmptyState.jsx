import { useLanguage } from "../context/LanguageContext.jsx";
import { Inbox, SearchX } from "lucide-react";

export default function EmptyState({ title = "No records yet", description, filtered = false, onClear, action }) {
  const { t } = useLanguage();

  return (
    <div className="empty-state">
      {filtered ? <SearchX size={28} aria-hidden="true" /> : <Inbox size={28} aria-hidden="true" />}
      <strong>{t(title)}</strong>
      {description && <span>{t(description)}</span>}
      {onClear && <button type="button" className="secondary-button" onClick={onClear}>{t("Clear filters")}</button>}
      {action && <button type="button" className="primary-button" onClick={action.onClick}>{t(action.label)}</button>}
    </div>
  );
}
