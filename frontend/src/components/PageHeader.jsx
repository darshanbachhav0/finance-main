import { useLanguage } from "../context/LanguageContext.jsx";

export default function PageHeader({ title, description, actions, help }) {
  const { t } = useLanguage();

  return (
    <div className="page-header">
      <div>
        <div className="page-title-row"><h1>{t(title)}</h1>{help}</div>
        {description && <p className="page-description" title={t(description)}>{t(description)}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
