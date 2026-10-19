import { useLanguage } from "../context/LanguageContext.jsx";

export default function PageHeader({ title, description, actions, help }) {
  const { t } = useLanguage();

  return (
    <header className="page-header">
      <div className="page-header-copy">
        <div className="page-title-row"><h1>{t(title)}</h1>{help}</div>
        {description && <p className="page-description">{t(description)}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
