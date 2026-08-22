import { useLanguage } from "../context/LanguageContext.jsx";

export default function EmptyState({ title = "No records found", description }) {
  const { t } = useLanguage();

  return (
    <div className="empty-state">
      <strong>{t(title)}</strong>
      {description && <span>{t(description)}</span>}
    </div>
  );
}
