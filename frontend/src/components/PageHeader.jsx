import { useLanguage } from "../context/LanguageContext.jsx";

export default function PageHeader({ title, description, actions }) {
  const { t } = useLanguage();

  return (
    <div className="page-header">
      <div>
        <h1>{t(title)}</h1>
        {description && <p>{t(description)}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
