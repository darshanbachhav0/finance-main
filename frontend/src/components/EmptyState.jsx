import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { Inbox, SearchX, X } from "lucide-react";

// The empty result of a list. It suggests the next step: "Clear filters" when filters hide the
// rows, otherwise the page's own `action` ({ label, to | onClick, icon }) when one exists.
// `compact` is the one-line form for an empty part of a record ("No history recorded.").
export default function EmptyState({ title = "No records yet", description, filtered = false, onClear, action, compact = false }) {
  const { t } = useLanguage();
  const ActionIcon = action?.icon;

  if (compact) return <p className="empty-state-compact"><Inbox size={16} aria-hidden="true" /><span>{t(title)}</span></p>;

  return (
    <div className="empty-state" role="status">
      {filtered ? <SearchX size={28} aria-hidden="true" /> : <Inbox size={28} aria-hidden="true" />}
      <strong>{t(title)}</strong>
      {description && <span>{t(description)}</span>}
      {(onClear || action) && <div className="empty-state-actions">
        {onClear && <button type="button" className="secondary-button" onClick={onClear}><X size={16} aria-hidden="true" />{t("Clear filters")}</button>}
        {!filtered && action && (action.to
          ? <Link className="primary-button" to={action.to}>{ActionIcon && <ActionIcon size={16} aria-hidden="true" />}<span>{t(action.label)}</span></Link>
          : <button type="button" className="primary-button" onClick={action.onClick}>{ActionIcon && <ActionIcon size={16} aria-hidden="true" />}<span>{t(action.label)}</span></button>)}
      </div>}
    </div>
  );
}
