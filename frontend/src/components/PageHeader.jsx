import { useLanguage } from "../context/LanguageContext.jsx";

export default function PageHeader({ title, description, actions }) {
  const { t } = useLanguage();

  return (
    <div className="page-header">
      <div>
        <h1>{t(title)}</h1>
        {description && <details className="page-help"><summary>{t("About this page")}</summary><p>{t(description)}</p></details>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
